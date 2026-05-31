import json

# --- Configuration ---
import os
import re

import pandas as pd
import torch
from anyio import Path
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer, util

# Get the absolute path to the directory containing app.py
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Construct the paths using standard string manipulation
ARTICLES_JSON_PATH = os.path.normpath(
    os.path.join(BASE_DIR, "..", "data", "numbers.json")
)
MODEL_NAME = "all-mpnet-base-v2"
EMBEDDINGS_PATH = os.path.normpath(
    os.path.join(
        BASE_DIR, "..", "data", "article_embeddings_all-mpnet-base-v2-flask.pt"
    )
)

# --- Global variables to hold our data in memory ---
articles_df = None
corpus_embeddings = None
sentence_model = None
bm25_index = None
article_id_to_embedding_idx = {}
embedding_idx_to_article_id = {}


def _tokenize(text):
    return re.findall(r"\w+", str(text).lower())


def load_data_and_embeddings():
    """Load all necessary data into memory when the server starts."""
    global articles_df, corpus_embeddings, sentence_model, bm25_index, article_id_to_embedding_idx, embedding_idx_to_article_id

    print("--- LOADING DATA ---")

    # 1. Load the articles JSON
    with open(ARTICLES_JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    all_articles_list = []
    recommendable_articles_list = []
    article_id_counter = 0

    # 2. Process all articles, not just those with descriptions
    for issue in data:
        for article in issue.get("artiklid", []):
            kirjeldus = article.get("kirjeldus", "")
            file_path = article.get("file_path", "")

            # Determine if an embedding should exist for this article
            has_embedding = article.get("create_embedding", False)

            article_data = {
                "id": article_id_counter,
                "aasta": issue.get("aasta", "N/A"),
                "kuu": issue.get("kuu", "N/A"),
                "pealkiri": article.get("pealkiri", "No Title"),
                "pealkiri_inglise": article.get("pealkiri_inglise", "No English Title"),
                "autor": article.get("autor", ""),
                "info": article.get("info", ""),
                "abstrakt": kirjeldus,
                "file_path": file_path,
                "create_embedding": has_embedding,
                "has_pdf": bool(file_path and file_path.strip()),
            }
            all_articles_list.append(article_data)

            # If the article has a description, map its global ID to its future embedding index
            if has_embedding:
                embedding_idx = len(recommendable_articles_list)
                article_id_to_embedding_idx[article_id_counter] = embedding_idx
                embedding_idx_to_article_id[embedding_idx] = article_id_counter
                recommendable_articles_list.append(article_data)

            article_id_counter += 1

    articles_df = pd.DataFrame(all_articles_list)
    print(f"✅ Loaded {len(articles_df)} total articles into DataFrame.")
    print(f"✅ Found {len(recommendable_articles_list)} articles for recommendations.")

    bm25_corpus = [
        _tokenize(f"{row['pealkiri']} {row['abstrakt']}") for row in all_articles_list
    ]
    bm25_index = BM25Okapi(bm25_corpus)
    print(f"✅ BM25 index built over {len(bm25_corpus)} articles.")

    # 3. Load the pre-computed embeddings
    try:
        corpus_embeddings = torch.load(
            EMBEDDINGS_PATH, map_location=torch.device("cpu")
        )
        print(f"✅ Loaded embeddings tensor with shape: {corpus_embeddings.shape}")
        # Sanity check
        if len(recommendable_articles_list) != corpus_embeddings.shape[0]:
            print(
                f"🚨 WARNING: Mismatch! Articles with description: {len(recommendable_articles_list)}, Embeddings: {corpus_embeddings.shape[0]}"
            )
    except FileNotFoundError:
        print(f"🚨 FATAL ERROR: Embedding file not found at '{EMBEDDINGS_PATH}'")
        exit()

    try:
        print(f"🧠 Loading SentenceTransformer model: '{MODEL_NAME}'...")
        # Load the model onto the CPU. Cloud Run instances may not have GPUs.
        sentence_model = SentenceTransformer(MODEL_NAME, device="cpu")
        print("✅ Model loaded successfully.")
    except Exception as e:
        print(f"🚨 FATAL ERROR: Could not load model '{MODEL_NAME}': {e}")
        exit()

    print("--- DATA LOADED SUCCESSFULLY ---")


# --- Initialize Flask App ---
app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)
load_data_and_embeddings()


# --- API Endpoints ---
@app.route("/")
def serve_index():
    """Serves the main index.html file."""
    return send_from_directory(".", "index.html")


@app.route("/api/articles")
def get_all_articles():
    """Returns the complete list of all articles as JSON."""
    if articles_df is not None:
        return jsonify(articles_df.to_dict(orient="records"))
    return jsonify({"error": "Data not loaded"}), 500


@app.route("/api/recommendations/<int:article_id>")
def get_recommendations_for_article(article_id):
    """Calculates and returns recommendations for a given article ID."""
    top_k = 5

    embedding_idx = article_id_to_embedding_idx.get(article_id)
    if embedding_idx is None:
        return (
            jsonify(
                {
                    "error": "Article ID not found or does not have a description for recommendations"
                }
            ),
            404,
        )

    query_embedding = corpus_embeddings[embedding_idx]
    cosine_scores = util.cos_sim(query_embedding, corpus_embeddings)[0]
    top_results = torch.topk(cosine_scores, k=top_k + 1)

    recommendations = []
    for score, doc_idx in zip(top_results[0], top_results[1]):
        doc_idx_int = doc_idx.item()

        # Map embedding index back to the global article ID
        rec_article_id = embedding_idx_to_article_id.get(doc_idx_int)
        if rec_article_id is None or rec_article_id == article_id:
            continue

        # Get article details from the main dataframe using its global ID
        rec_article = articles_df.iloc[rec_article_id]
        recommendations.append(
            {
                "id": int(rec_article["id"]),
                "pealkiri": rec_article["pealkiri"],
                "autor": rec_article["autor"],
                "score": round(score.item(), 4),
                "aasta": int(rec_article["aasta"]),
                "kuu": int(rec_article["kuu"]),
                "file_path": rec_article[
                    "file_path"
                ],  # Pass the direct path for linking
            }
        )

    return jsonify(recommendations)


@app.route("/api/search")
def search_articles_endpoint():
    """
    Performs a free-text search based on a query parameter.
    """
    query = request.args.get("q")
    if not query:
        return jsonify({"error": "Missing query parameter 'q'"}), 400

    min_results = 10
    similarity_threshold = 0.4  # also return all articles above this score

    if sentence_model is None or corpus_embeddings is None:
        return jsonify({"error": "Server is not ready, model not loaded"}), 503

    # 1. Generate query embedding
    query_embedding = sentence_model.encode(
        query, convert_to_tensor=True, show_progress_bar=False, device="cpu"  # Use CPU
    )

    # 2. Compute cosine similarity
    cosine_scores = util.cos_sim(query_embedding, corpus_embeddings)[0]
    print(cosine_scores)

    # 3. Get top results: at least min_results, plus any above the threshold
    above_threshold = int((cosine_scores >= similarity_threshold).sum().item())
    top_k = max(min_results, above_threshold)
    top_results = torch.topk(cosine_scores, k=top_k)

    # 4. Format cosine results
    results = []
    for score, doc_idx in zip(top_results[0], top_results[1]):
        doc_idx_int = doc_idx.item()

        article_id = embedding_idx_to_article_id.get(doc_idx_int)
        if article_id is None:
            continue

        article = articles_df.iloc[article_id]
        results.append(
            {
                "id": int(article["id"]),
                "pealkiri": article["pealkiri"],
                "autor": article["autor"],
                "score": round(score.item(), 4),
                "aasta": int(article["aasta"]),
                "kuu": int(article["kuu"]),
                "file_path": article["file_path"],
            }
        )

    cosine_ids = {r["id"] for r in results}

    # 5a. Exact phrase match on autor and info — full query must appear verbatim
    phrase = query.lower()
    exact_mask = articles_df["autor"].str.lower().str.contains(
        phrase, na=False, regex=False
    ) | articles_df["info"].str.lower().str.contains(phrase, na=False, regex=False)
    for _, article in articles_df[exact_mask].iterrows():
        if int(article["id"]) not in cosine_ids:
            cosine_ids.add(int(article["id"]))
            results.append(
                {
                    "id": int(article["id"]),
                    "pealkiri": article["pealkiri"],
                    "autor": article["autor"],
                    "score": 0.0,
                    "aasta": int(article["aasta"]),
                    "kuu": int(article["kuu"]),
                    "file_path": article["file_path"],
                }
            )

    # 5b. BM25 on pealkiri and abstrakt — append remaining hits not already included
    tokens = _tokenize(query)
    bm25_scores = bm25_index.get_scores(tokens)
    bm25_hits = sorted(
        ((score, idx) for idx, score in enumerate(bm25_scores) if score > 0),
        key=lambda x: -x[0],
    )
    bm25_added = 0
    for bm25_score, article_idx in bm25_hits:
        if bm25_added >= 15:
            break
        article = articles_df.iloc[article_idx]
        if int(article["id"]) not in cosine_ids:
            cosine_ids.add(int(article["id"]))
            results.append(
                {
                    "id": int(article["id"]),
                    "pealkiri": article["pealkiri"],
                    "autor": article["autor"],
                    "score": 0.0,
                    "aasta": int(article["aasta"]),
                    "kuu": int(article["kuu"]),
                    "file_path": article["file_path"],
                }
            )
            bm25_added += 1

    return jsonify(results)


# --- Main Execution Block (for local development only) ---
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
