import json
import os
import pandas as pd
import torch
import hdbscan
import numpy as np
from typing import List
from sentence_transformers import SentenceTransformer
from bertopic import BERTopic
from sklearn.feature_extraction.text import CountVectorizer

from GoogleGenerativeAI import GoogleGenerativeAI
import google.generativeai as genai


def load_and_flatten_data(json_path='numbers.json'):
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    all_articles = []
    for issue in data:
        for article in issue.get('artiklid', []):
            if article.get('create_embedding'):
                article_data = {
                    'aasta': issue['aasta'],
                    'kuu': issue['kuu'],
                    'pealkiri': article.get('pealkiri', 'N/A'),
                    'autor': article.get('autor', 'N/A'),
                    'kirjeldus': article.get('kirjeldus', ''),
                }
                all_articles.append(article_data)

    return pd.DataFrame(all_articles)


def generate_embeddings(df, model_name='all-MiniLM-L6-v2'):
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"Using device: {device}")
    model = SentenceTransformer(model_name, device=device)
    corpus = df['kirjeldus'].tolist()
    print(f"Generating embeddings for {len(corpus)} abstracts...")
    embeddings = model.encode(corpus, convert_to_tensor=True, show_progress_bar=True)
    return embeddings


class TopicModelService:
    """
    Handles the core logic of loading data, generating embeddings,
    and building the topic model and hierarchy using GoogleGenerativeAI.
    """

    def __init__(self, embedding_model_name: str, corpus_json_path: str):
        self.model_name = embedding_model_name
        self.json_path = corpus_json_path
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        print(f"Using device: {self.device}")

    def _get_embeddings(self, df: pd.DataFrame) -> np.ndarray:
        """Loads or generates embeddings, returns a CPU-based numpy array."""
        embedding_file = f'article_embeddings_{self.model_name}-flask.pt'

        if os.path.exists(embedding_file):
            print(f"Loading cached embeddings from {embedding_file}...")
            embeddings_tensor = torch.load(embedding_file)
        else:
            print("Generating new embeddings...")
            model = SentenceTransformer(self.model_name, device=self.device)
            corpus = df['kirjeldus'].tolist()
            embeddings_tensor = model.encode(corpus, convert_to_tensor=True, show_progress_bar=True)
            torch.save(embeddings_tensor, embedding_file)
            print(f"Saved new embeddings to {embedding_file}")

        return embeddings_tensor.cpu().numpy()

    def build_and_save_model(self, model_save_path: str, hierarchy_save_path: str):
        """
        Runs the full topic modeling pipeline and saves the artifacts.
        """
        # 0. Configure API Key (Moved inside the service)
        try:
            api_key = os.getenv("GOOGLE_API_KEY")
            if not api_key:
                raise ValueError("GOOGLE_API_KEY environment variable not found.")
            genai.configure(api_key=api_key)
            print("🔑 API key configured successfully.")
        except Exception as e:
            print(f"🚨 Error configuring API key: {e}")
            return  # Cannot proceed

        # 1. Load Data
        articles_df = load_and_flatten_data(self.json_path)
        docs = articles_df['kirjeldus'].tolist()

        # 2. Get Embeddings
        embeddings_np = self._get_embeddings(articles_df)

        # 3. Define and Fit Model (with Gemini)
        print("🧠 Generating base topics with BERTopic...")
        hdbscan_model = hdbscan.HDBSCAN(min_cluster_size=5, min_samples=5, metric='euclidean',
                                        cluster_selection_method='leaf', prediction_data=True)

        # --- NEW: Define the Gemini Representation Model ---
        gemini_model = genai.GenerativeModel('gemini-2.5-flash')
        representation_model = GoogleGenerativeAI(
            gemini_model,
            doc_length=50,
            tokenizer='char',
            diversity=0.5,
        )

        topic_model = BERTopic(
            hdbscan_model=hdbscan_model,
            language="english",
            verbose=True,
            vectorizer_model=CountVectorizer(ngram_range=(1, 3), min_df=2, stop_words="english"),
            representation_model=representation_model  # <-- Re-added Gemini
        )

        # This will be slow as it calls the API for all leaf topics
        print("Fitting topic model (API calls will be made)...")
        topics, _ = topic_model.fit_transform(docs, embeddings_np)

        # 4. Reduce Outliers
        print("Reducing outliers...")
        topics = topic_model.reduce_outliers(docs, topics, strategy="embeddings", embeddings=embeddings_np)

        # 5. Build Hierarchy
        # This will also be slow as it calls the API for all new parent topics
        print("🌳 Building topic hierarchy (more API calls will be made)...")
        hierarchical_topics = topic_model.hierarchical_topics(docs)

        # 6. Save Artifacts
        print(f"Saving model to {model_save_path}...")
        topic_model.save(model_save_path, serialization="safetensors")

        print(f"Saving hierarchy to {hierarchy_save_path}...")
        hierarchical_topics.to_parquet(hierarchy_save_path)

        print("✅ Model building complete.")


# --- Main execution block for Part 1 ---
if __name__ == '__main__':
    MODEL_NAME = 'all-mpnet-base-v2'
    JSON_PATH = '../data/numbers.json'
    MODEL_SAVE_PATH = "../data/akadeemia_topic_model_gemini"  # Use a new name
    HIERARCHY_SAVE_PATH = "../data/akadeemia_hierarchy_gemini.parquet"

    service = TopicModelService(embedding_model_name=MODEL_NAME, corpus_json_path=JSON_PATH)
    service.build_and_save_model(MODEL_SAVE_PATH, HIERARCHY_SAVE_PATH)