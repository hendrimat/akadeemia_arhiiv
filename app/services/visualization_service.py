import json
import pathlib

import pandas as pd
import numpy as np
import torch
import create_plots as map
from umap import UMAP
from bertopic import BERTopic
from typing import List
import math
import os
from scipy.stats import gaussian_kde

OUTLIER_NAME = "OUTLIERS"
PROJECTION_CACHE_FILE = "../data/umap_projection_2d.npy"  # Name of the cache file

def load_and_flatten_data(json_path='../data/numbers.json'):
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
                    'file_path': article.get('file_path', ''),
                    'info': article.get('info', ''),
                }
                all_articles.append(article_data)

    return pd.DataFrame(all_articles)


def create_generative_label_layers(
        topic_model: BERTopic,
        hierarchical_topics: pd.DataFrame,
        nr_levels: int,
        level_scale: str = "linear"
) -> List[List[str]]:
    """
    Generates hierarchical label layers for datamapplot using the
    pre-generated labels from a BERTopic model (e.g., from Gemini).
    """

    # --- 1. Get document-topic assignments ---
    topic_per_doc = np.array(topic_model.topics_)

    # --- 2. Calculate Level Cut-offs (copied from BERTopic) ---
    distances = hierarchical_topics.Distance.to_list()
    if level_scale == "log" or level_scale == "logarithmic":
        log_indices = (
            np.round(
                np.logspace(
                    start=math.log(1, 10),
                    stop=math.log(len(distances) - 1, 10),
                    num=nr_levels,
                )
            )
            .astype(int)
            .tolist()
        )
        log_indices.reverse()
        max_distances = [distances[i] for i in log_indices]
    elif level_scale == "lin" or level_scale == "linear":
        max_distances = [
                            distances[indices[-1]] for indices in
                            np.array_split(range(len(hierarchical_topics)), nr_levels)
                        ][::-1]  # [most_general, ..., most_specific]
    else:
        raise ValueError("level_scale needs to be one of 'log' or 'linear'")

    # --- 3. Create a master map of Topic_ID -> Generative_Label ---

    # Get labels for leaf topics
    leaf_topics = topic_model.get_topic_info()

    # Create a pandas Series of the names
    names_series = pd.Series(leaf_topics.Name.values, index=leaf_topics.Topic.values)

    # Clean the names: split at the first underscore and take the second part
    cleaned_names = names_series.astype(str).str.split('_', n=1).str[-1]

    # Convert the *cleaned* names to the label map
    label_map = cleaned_names.to_dict()

    # Get labels for parent topics
    parent_labels = hierarchical_topics[['Parent_ID', 'Parent_Name']].drop_duplicates()
    parent_map = pd.Series(parent_labels.Parent_Name.values, index=parent_labels.Parent_ID.astype(int)).to_dict()

    # Combine them and add outlier label
    label_map.update(parent_map)
    label_map[-1] = OUTLIER_NAME  # Ensure outlier label exists
    # convert to uppercase
    label_map = {k: v.upper() for k, v in label_map.items()}

    # --- 4. Calculate Topic Mappings and Labels for Each Level ---
    final_label_layers: List[List[str]] = []

    for max_distance in max_distances:
        # Create a mapping for all topics at this distance
        mapping = {topic: topic for topic in np.unique(topic_per_doc)}
        selection = hierarchical_topics.loc[hierarchical_topics.Distance <= max_distance, :]
        selection.Parent_ID = selection.Parent_ID.astype(int)
        selection = selection.sort_values("Parent_ID")

        for _, row in selection.iterrows():
            for topic in row.Topics:
                mapping[topic] = row.Parent_ID

        # Flatten the mapping
        mappings_updated = [True for _ in mapping]
        while any(mappings_updated):
            for i, (key, value) in enumerate(mapping.items()):
                if value in mapping.keys() and key != value:
                    mapping[key] = mapping[value]
                else:
                    mappings_updated[i] = False

        # Map each document's original topic to its parent ID at this level
        current_level_topic_ids = [mapping.get(topic, topic) for topic in topic_per_doc]

        # --- 5. Map Topic IDs to Generative Labels ---
        # Instead of building labels, we just look them up in our master map
        current_level_doc_labels = [label_map.get(topic_id, str(topic_id)) for topic_id in current_level_topic_ids]
        final_label_layers.append(current_level_doc_labels)

    return final_label_layers


class VisualizationService:
    """
    Handles loading a pre-trained BERTopic model and generating
    a datamapplot visualization.
    """

    def __init__(self, model_load_path: str, hierarchy_load_path: str, corpus_json_path: str):
        print("Loading artifacts...")
        self.topic_model = BERTopic.load(model_load_path)
        self.hierarchical_topics = pd.read_parquet(hierarchy_load_path)
        self.articles_df = load_and_flatten_data(corpus_json_path)
        self.docs = self.articles_df['kirjeldus'].tolist()
        print("Artifacts loaded.")

    def _create_2d_projection(self) -> np.ndarray:
        """
        Creates the 2D UMAP projection required for the plot.
        Checks if a cached .npy file exists first.
        """
        # --- CACHING LOGIC START ---
        if os.path.exists(PROJECTION_CACHE_FILE):
            print(f"💾 Found cached projection at '{PROJECTION_CACHE_FILE}'. Loading...")
            try:
                projection = np.load(PROJECTION_CACHE_FILE)
                # Simple sanity check: does the length match our data?
                if len(projection) == len(self.articles_df):
                    return projection
                else:
                    print("⚠️ Cached projection length does not match data length. Recomputing...")
            except Exception as e:
                print(f"⚠️ Error loading cache: {e}. Recomputing...")
        # --- CACHING LOGIC END ---

        embedding_file = '../data/article_embeddings_all-mpnet-base-v2-flask.pt'
        if not os.path.exists(embedding_file):
            raise FileNotFoundError(f"Could not find embedding cache file: {embedding_file}. "
                                    "Please run build_topic_model.py first.")

        print("Loading embeddings for 2D projection...")
        embeddings_np = torch.load(embedding_file, map_location="cpu").numpy()

        print("🗺️ Generating 2D projection (this may take a moment)...")
        umap_2d_model = UMAP(n_neighbors=20, n_components=2, min_dist=0.0, metric='cosine', random_state=42)
        projection = umap_2d_model.fit_transform(embeddings_np)

        # Save to cache
        print(f"💾 Saving projection to cache: '{PROJECTION_CACHE_FILE}'")
        np.save(PROJECTION_CACHE_FILE, projection)

        return projection

    def _prepare_hover_text(self) -> List[str]:
        """
        Generates hover text using the model's final topic assignments.
        """
        print("Preparing hover text...")
        topic_info = self.topic_model.get_topic_info()
        cleaned_names = topic_info.Name.astype(str).str.split('_', n=1).str[-1]
        topic_map = pd.Series(
            cleaned_names.values,
            index=topic_info.Topic.values
        ).to_dict()
        doc_topics = self.topic_model.topics_
        specific_topic_names = [topic_map.get(t, OUTLIER_NAME) for t in doc_topics]

        hover_text = [
            f"{str(row.pealkiri).replace('`', '')}\n"
            f"{str(row.autor).replace('`', '')}\n"
            f"{str(row.aasta)} / {str(row.kuu)}\n"
            f"{'' if (specific_topic_names[i] == OUTLIER_NAME or specific_topic_names[i] == '') else f'Teema: {str(specific_topic_names[i]).replace('`', '')}'}"
            for i, (index, row) in enumerate(self.articles_df.iterrows())
        ]
        return hover_text, specific_topic_names

    def create_plot(self, num_levels: int) -> str:
        """
        Generates the hierarchical labels and returns the interactive plot as a string.
        """
        # 1. Create 2D Projection (with cache)
        projection_2d = self._create_2d_projection()

        # 2. Prepare Hover Text
        hover_text, specific_topic_names = self._prepare_hover_text()

        # 3. Generate Label Layers
        print(f"🏷️ Generating {num_levels} hierarchical generative labels...")
        label_layers = create_generative_label_layers(
            self.topic_model,
            self.hierarchical_topics,
            nr_levels=num_levels,
            level_scale="log"
        )

        print(f"Generated {len(label_layers)} unique label layers.")

        print("Creating date data for colormap...")
        date_df = pd.DataFrame({
            'year': self.articles_df['aasta'],
            'month': self.articles_df['kuu'],
            'day': 1
        })
        date_data = pd.to_datetime(date_df)

        print("Calculating density data with SciPy KDE...")
        xy = projection_2d.T
        kde = gaussian_kde(xy)
        density_data = kde(xy)

        def clean_text(val):
            if pd.isna(val): return ""
            return str(val).replace('"', '&quot;').replace('`', '')

        # 1. Pre-calculate columns to avoid overhead inside loops
        # Assuming specific_topic_names aligns with the dataframe index
        topics = [
            clean_text(name) if name != OUTLIER_NAME else ""
            for name in specific_topic_names
        ]

        # 2. Create DataFrame using vectorized operations/map where possible
        extra_data = pd.DataFrame({
            "title": self.articles_df['pealkiri'].map(clean_text),
            "author": self.articles_df['autor'].map(clean_text),
            # Vectorized string concatenation is much faster than row iteration
            "date": (self.articles_df['aasta'].astype(str) + " / " + self.articles_df['kuu'].astype(str)),
            "file_path": self.articles_df['file_path'].map(clean_text),
            "abstract": self.articles_df['kirjeldus'].map(clean_text).replace("nan", "Sisukokkuvõte puudub.")
            if 'kirjeldus' in self.articles_df.columns
            else "Sisukokkuvõte puudub.",
            "info": self.articles_df['info'].map(clean_text) if 'info' in self.articles_df.columns else "",
            "topic": topics
        })

        on_click_js = """
            // This JS will be executed when a point is clicked.
            // The {property} syntax will be replaced with the actual data of the clicked point.
            let container = document.getElementById("point-info-container");
            if (!container) {{
                console.error("Container #point-info-container not found!");
                return;
            }}
            
            const headerMeta = document.getElementById("point-header-meta");
            if (headerMeta) {{
                headerMeta.innerHTML = `{date}`;
            }}

            const contentBox = document.getElementById("point-info-content");
            contentBox.innerHTML = `
                <details open>
                    <summary class="article-summary">
                        <div class="title"><p>{title}</p></div>
                        <div class="author-info"><p><em>{author}</em></p><p class="text-gray"><em>{info}</em></p></div>
                    </summary>
                    <article>
                        <div class="details-section"><p class="abstract-text is-clamped">{abstract}</p><button class="toggle-abstract-btn">Loe edasi</button></div>
                        <div><a href="{file_path}" target="_blank" class="goto-article-btn outline" style="text-decoration: none;">&gt;&nbsp; NÄITA NUMBRIS</a></div>
                    </article>
                </details>
            `;

            const abstractText = contentBox.querySelector('.abstract-text');
            const toggleBtn = contentBox.querySelector('.toggle-abstract-btn');
            if (abstractText && toggleBtn) {{
                toggleBtn.onclick = (e) => {{
                    e.preventDefault();
                    abstractText.classList.toggle('is-clamped');
                    toggleBtn.textContent = abstractText.classList.contains('is-clamped') ? "Loe edasi" : "Sulge";
                }};
            }}
            container.style.display = "block";
        """

        # 4. Create Plot
        print("Creating interactive plot...")
        plot_html = map.create_interactive_plot(
            projection_2d,
            *label_layers,
            hover_text=hover_text,
            noise_label=OUTLIER_NAME,
            enable_topic_tree=True,
            font_family="Josefin Sans",
            tooltip_font_family="Tinos",
            tooltip_css=
            """
            .deck-tooltip {
                background-color: #ffffff;
                color: var(--text-color);
                border: 1px solid var(--text-color);
                padding: var(--spacing);
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                font-size: 0.9rem;
                z-index: 10000;
            }
            """,
            color_label_text=False,
            colormap_rawdata=[date_data, density_data],
            colormap_metadata=[{"field": "date", "description": "KUU", "cmap": "cet_CET_L15", "kind": "datetime"},
                               {"field": "density", "description": "TIHEDUS", "cmap": "cet_CET_L12", "kind": "continuous"}],
            topic_tree_kwds={"title": "TEEMAD", "color_bullets": True},
            initial_zoom_fraction=0.9,
            histogram_data=date_data,
            histogram_group_datetime_by="month",
            histogram_settings={"histogram_width": "350", "histogram_height": "90"},
            cluster_layer_colormaps=True,
            enable_search=True,
            on_click=on_click_js,
            extra_point_data=extra_data,
            offline_data_path=os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', "web", "plot"))
        )

        return plot_html


# --- Main execution block for generating static files ---
if __name__ == '__main__':
    # These must match the output of your data preparation steps
    MODEL_LOAD_PATH = "../data/akadeemia_topic_model_gemini"
    HIERARCHY_LOAD_PATH = "../data/akadeemia_hierarchy_gemini.parquet"
    JSON_PATH = '../data/numbers.json'
    NUM_ZOOM_LEVELS = 3

    service = VisualizationService(MODEL_LOAD_PATH, HIERARCHY_LOAD_PATH, JSON_PATH)
    plot_html = service.create_plot(NUM_ZOOM_LEVELS)
    print("✅ Interactive plot created.")

    # Define output directory relative to the project root to ensure correct pathing
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, '..', '..'))
    static_dir = os.path.join(project_root, "app", "web")

    # Create directories if they don't exist
    os.makedirs(static_dir, exist_ok=True)
    with open(os.path.join(static_dir, "kaart.html"), "w", encoding="utf-8") as f:
        f.write(plot_html)

    print(f"✅ Plot saved to '{static_dir}/'.")
