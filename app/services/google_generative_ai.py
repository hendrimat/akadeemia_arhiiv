import time
# import openai  # Removed
import google.generativeai as genai  # Added
from google.api_core import exceptions as google_exceptions  # Added
import pandas as pd
from tqdm import tqdm
from scipy.sparse import csr_matrix
from typing import Mapping, List, Tuple, Any, Union, Callable
from bertopic.representation._base import BaseRepresentation
from bertopic.representation._utils import (
    retry_with_exponential_backoff,
    truncate_document,
    validate_truncate_document_parameters,
)

# DEFAULT_CHAT_PROMPT and DEFAULT_SYSTEM_PROMPT remain unchanged
DEFAULT_CHAT_PROMPT = """You will generate a Estonian topic label for the cluster of articles from the Estonian academic magazine Akadeemia.

# Your task
Sample abstracts for articles from this topic:
[DOCUMENTS]

Keywords: [KEYWORDS]

Based on the information above, extract a short Estonian topic label (three words at most and in sentence case) in the following format:
topic: <topic_label>
"""

DEFAULT_SYSTEM_PROMPT = "You are an assistant that extracts high-level topics from texts."


class GoogleGenerativeAI(BaseRepresentation):
    r"""Using the Google Generative AI API to generate topic labels.

    For an overview see:
    https://ai.google.dev/docs

    Arguments:
        model: A `genai.GenerativeModel` instance.
        prompt: The prompt to be used in the model. If no prompt is given,
                `self.default_prompt_` is used instead.
                NOTE: Use `"[KEYWORDS]"` and `"[DOCUMENTS]"` in the prompt
                to decide where the keywords and documents need to be
                inserted.
        system_prompt: The system prompt to be used in the model. If no system prompt is given,
                       `self.default_system_prompt_` is used instead. This is sent
                       as the first part of the prompt to `model.generate_content`.
        generator_kwargs: Kwargs passed to `model.generate_content` as
                          `generation_config` for fine-tuning the output.
                          NOTE: `stop` is automatically converted to `stop_sequences`.
        delay_in_seconds: The delay in seconds between consecutive prompts
                          in order to prevent RateLimitErrors.
        exponential_backoff: Retry requests with a random exponential backoff.
                             A short sleep is used when a rate limit error is hit,
                             then the requests is retried. Increase the sleep length
                             if errors are hit until 10 unsuccessful requests.
                             If True, overrides `delay_in_seconds`.
        nr_docs: The number of documents to pass to the model if a prompt
                 with the `["DOCUMENTS"]` tag is used.
        diversity: The diversity of documents to pass to the model.
                   Accepts values between 0 and 1. A higher
                   values results in passing more diverse documents
                   whereas lower values passes more similar documents.
        doc_length: The maximum length of each document. If a document is longer,
                    it will be truncated. If None, the entire document is passed.
        tokenizer: The tokenizer used to calculate to split the document into segments
                   used to count the length of a document.
                   (See original class docstring for options)

    Usage:

    To use this, you will need to install the google-generativeai package first:

    `pip install google-generativeai`

    Then, configure your API key and use the model as follows:

    ```python
    import google.generativeai as genai
    from bertopic.representation import GoogleGenerativeAI # (This class)
    from bertopic import BERTopic

    # Configure the client
    genai.configure(api_key="YOUR_API_KEY")

    # Create your representation model
    gemini_model = genai.GenerativeModel('gemini-1.5-flash')
    representation_model = GoogleGenerativeAI(gemini_model, delay_in_seconds=5)

    # Use the representation model in BERTopic
    topic_model = BERTopic(representation_model=representation_model)
    ```

    You can also use a custom prompt:

    ```python
    prompt = "I have the following documents: [DOCUMENTS] \nThese documents are about the following topic: '"
    representation_model = GoogleGenerativeAI(gemini_model, prompt=prompt, delay_in_seconds=5)
    ```
    """

    def __init__(
            self,
            model: "genai.GenerativeModel",  # Changed: Expect a genai.GenerativeModel
            prompt: str = None,
            system_prompt: str = None,
            generator_kwargs: Mapping[str, Any] = {},
            delay_in_seconds: float = None,
            exponential_backoff: bool = False,
            nr_docs: int = 4,
            diversity: float = None,
            doc_length: int = None,
            tokenizer: Union[str, Callable] = None,
            **kwargs,
    ):
        self.model = model  # This is the genai.GenerativeModel object

        if prompt is None:
            self.prompt = DEFAULT_CHAT_PROMPT
        else:
            self.prompt = prompt

        if system_prompt is None:
            self.system_prompt = DEFAULT_SYSTEM_PROMPT
        else:
            self.system_prompt = system_prompt

        self.default_prompt_ = DEFAULT_CHAT_PROMPT
        self.default_system_prompt_ = DEFAULT_SYSTEM_PROMPT
        self.delay_in_seconds = delay_in_seconds
        self.exponential_backoff = exponential_backoff
        self.nr_docs = nr_docs
        self.diversity = diversity
        self.doc_length = doc_length
        self.tokenizer = tokenizer
        validate_truncate_document_parameters(self.tokenizer, self.doc_length)

        self.prompts_ = []

        # Adapt generator_kwargs for Google's GenerationConfig
        self.generator_kwargs = dict(generator_kwargs)
        if "model" in self.generator_kwargs:
            del self.generator_kwargs["model"]
        if "prompt" in self.generator_kwargs:
            del self.generator_kwargs["prompt"]

        # Translate 'stop' to 'stop_sequences'
        if "stop_sequences" not in self.generator_kwargs and "stop" not in self.generator_kwargs:
            self.generator_kwargs["stop_sequences"] = ["\n"]
        elif "stop" in self.generator_kwargs:
            self.generator_kwargs["stop_sequences"] = [self.generator_kwargs.pop("stop")]

    def extract_topics(
            self,
            topic_model,
            documents: pd.DataFrame,
            c_tf_idf: csr_matrix,
            topics: Mapping[str, List[Tuple[str, float]]],
    ) -> Mapping[str, List[Tuple[str, float]]]:
        """Extract topics.

        Arguments:
            topic_model: A BERTopic model
            documents: All input documents
            c_tf_idf: The topic c-TF-IDF representation
            topics: The candidate topics as calculated with c-TF-IDF

        Returns:
            updated_topics: Updated topic representations
        """
        # Extract the top n representative documents per topic
        repr_docs_mappings, _, _, _ = topic_model._extract_representative_docs(
            c_tf_idf, documents, topics, 500, self.nr_docs, self.diversity
        )

        # Generate using Google's Generative Model
        updated_topics = {}
        for topic, docs in tqdm(repr_docs_mappings.items(), disable=not topic_model.verbose):
            truncated_docs = [truncate_document(topic_model, self.doc_length, self.tokenizer, doc) for doc in docs]
            prompt = self._create_prompt(truncated_docs, topic, topics)
            self.prompts_.append(prompt)

            # Delay
            if self.delay_in_seconds:
                time.sleep(self.delay_in_seconds)

            # Create prompt parts for Google
            prompt_parts = [self.system_prompt, prompt]

            # Set up kwargs for API call
            kwargs = {
                "contents": prompt_parts,
                "generation_config": self.generator_kwargs,
            }

            try:
                if self.exponential_backoff:
                    response = generate_with_backoff(self.model, **kwargs)
                else:
                    response = self.model.generate_content(**kwargs)

                # Parse response
                label = response.text.strip().replace("topic: ", "")
                if not label:
                    label = "No label returned"

            except Exception as e:
                # Catch broad exceptions (e.g., blockages, API errors)
                print(f"Warning: Topic {topic} label generation failed: {e}")
                label = "No label returned"

            updated_topics[topic] = [(label, 1)]

        return updated_topics

    def _create_prompt(self, docs, topic, topics):
        keywords = list(zip(*topics[topic]))[0]

        # Use the Default Chat Prompt
        if self.prompt == DEFAULT_CHAT_PROMPT:
            prompt = self.prompt.replace("[KEYWORDS]", ", ".join(keywords))
            prompt = self._replace_documents(prompt, docs)

        # Use a custom prompt that leverages keywords, documents or both using
        # custom tags, namely [KEYWORDS] and [DOCUMENTS] respectively
        else:
            prompt = self.prompt
            if "[KEYWORDS]" in prompt:
                prompt = prompt.replace("[KEYWORDS]", ", ".join(keywords))
            if "[DOCUMENTS]" in prompt:
                prompt = self._replace_documents(prompt, docs)

        return prompt

    @staticmethod
    def _replace_documents(prompt, docs):
        to_replace = ""
        for doc in docs:
            to_replace += f"- {doc}\n"
        prompt = prompt.replace("[DOCUMENTS]", to_replace)
        return prompt


def generate_with_backoff(model: "genai.GenerativeModel", **kwargs):
    """
    Wrapper for `retry_with_exponential_backoff` to handle
    Google's `ResourceExhausted` rate limit error.
    """
    return retry_with_exponential_backoff(
        model.generate_content,
        errors=(google_exceptions.ResourceExhausted, google_exceptions.ServiceUnavailable),
    )(**kwargs)