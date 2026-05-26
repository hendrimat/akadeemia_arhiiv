import numpy as np
import pandas as pd
import textwrap
import colorcet

from matplotlib.colors import to_rgb

from palette_handling import (
    palette_from_datamap,
    palette_from_cmap_and_datamap,
    deep_palette,
    pastel_palette,
)
from interactive_rendering import (
    render_html,
    compute_percentile_bounds,
    label_text_and_polygon_dataframes,
)

def create_interactive_plot(
    data_map_coords,
    *label_layers,
    hover_text=None,
    noise_label="Unlabelled",
    noise_color="#999999",
    color_label_text=True,
    label_wrap_width=16,
    label_color_map=None,
    width="100%",
    height=800,
    darkmode=False,
    palette_hue_shift=0.0,
    palette_hue_radius_dependence=1.0,
    palette_theta_range=np.pi / 16,
    cmap=None,
    marker_size_array=None,
    marker_color_array=None,
    marker_alpha_array=None,
    use_medoids=False,
    cluster_boundary_polygons=False,
    color_cluster_boundaries=True,
    polygon_alpha=0.1,
    cvd_safer=False,
    enable_topic_tree=False,
    histogram_enable_click_persistence=False,
    **render_html_kwds,
):
    """

    Parameters
    ----------
    data_map_coords: ndarray of floats of shape (n_samples, 2)
        The 2D coordinates for the data map. Usually this is produced via a
        dimension reduction technique such as UMAP, t-SNE, PacMAP, PyMDE etc.

    *label_layers: np.ndarray
        All remaining positional arguments are assumed to be labels, each at
        a different level of resolution. Ideally these should be ordered such that
        the most fine-grained resolution is first, and the coarsest resolution is last.
        The individual labels-layers should be formatted the same as for `create_plot`.

    hover_text: list or np.ndarray or None (optional, default=None)
        An iterable (usually a list of numpy array) of text strings, one for each
        data point in `data_map_coords` that can be used in a tooltip when hovering
        over points.

    noise_label: str (optional, default="Unlabelled")
        The string used in the ``labels`` array to identify the unlabelled or noise points
        in the dataset.

    noise_color: str (optional, default="#999999")
        The colour to use for unlabelled or noise points in the data map. This should usually
        be a muted or neutral colour to distinguish background points from the labelled clusters.

    color_label_text: bool (optional, default=True)
        Whether to use colours for the text labels generated in the plot. If ``False`` then
        the text labels will default to either black or white depending on ``darkmode``.

    label_wrap_width: int (optional, default=16)
        The number of characters to apply text-wrapping at when creating text labels for
        display in the plot. Note that long words will not be broken, so you can choose
        relatively small values if you want tight text-wrapping.

    label_color_map: dict or None (optional, default=None)
        A colour mapping to use to colour points/clusters in the data map. The mapping should
        be keyed by the unique cluster labels in ``labels`` and take values that are hex-string
        representations of colours. If ``None`` then a colour mapping will be auto-generated.

    width: int or str (optional, default="100%")
        The width of the plot when rendered in a notebook. This should be a valid HTML iframe
        width specification -- either an integer number of pixels, or a string that can be
        properly interpreted in HTML.

    height: int or str (optional, default=800)
        The height of the plot when rendered in a notebook. This should be a valid HTML iframe
        height specification -- either an integer number of pixels, or a string that can be
        properly interpreted in HTML.

    darkmode: bool (optional, default=False)
        Whether to render the plot in darkmode (with a dark background) or not.

    palette_hue_shift: float (optional, default=0.0)
        A setting, in degrees clockwise, to shift the hue channel when generating a colour
        palette and color_mapping for the labels.

    palette_hue_radius_dependence: float (optional, default=1.0)
        A setting that determines how dependent on the radius the hue channel is. Larger
        values will result in more hue variation where there are more outlying points.

    palette_theta_range: float (optional, default=np.pi/16)
        A setting that determines how restrictive the radius mask used will be. Larger
        values will result in a less restrictive mask.

    cmap: matplotlib cmap or None (optional, default=None)
        A linear matplotlib cmap colour map to use as the base for a generated colour mapping.
        This *should* be a matplotlib cmap that is smooth and linear, and cyclic
        (see the colorcet package for some good options). If not a cyclic cmap it will be
        "made" cyclic by reflecting it. If ``None`` then a custom method will be used instead.

    marker_size_array: np.ndarray or None (optional, default=None)
        An array of sizes for each of the points in the data map scatterplot.

    marker_alpha_array: np.ndarray or None (optional, default=None)
        An array of alpha values for each of the points in the data map scatterplot.

    use_medoids: bool (optional, default=False)
        Whether to use medoids instead of centroids to determine the "location" of the cluster,
        both for the label indicator line, and for palette colouring. Note that medoids are
        more computationally expensive, especially for large plots, so use with some caution.

    cluster_boundary_polygons: bool (optional, default=False)
        Whether to draw alpha-shape generated boundary lines around clusters. This can be useful
        in highlighting clusters at different resolutions when using many different label_layers.

    polygon_alpha: float (optional, default=0.1)
        The alpha value to use when genrating alpha-shape based boundaries around clusters.

    cvd_safer: bool (optional, default=False)
        Whether to use a colour palette that is safer for colour vision deficiency (CVD).
        This will override any provided cmap and use a CVD safer palette instead.

    jupyterhub_api_token: str or None (optional, default=None)
        The JupyterHub API token to use when rendering the plot inline in a notebook via jupyterhub.
        This should not be necessary for most users, but can be useful in some environments where
        the default token is not available.

    enable_topic_tree: bool (optional, default=False)
        Whether to build and display a topic tree with the label heirarchy.
        
    return_parts: bool (optional, default=False)
        Whether to return the HTML, JS and CSS as a dictionary of parts, or as a single
        InteractiveFigure object.

    **render_html_kwds:
        All other keyword arguments will be passed through the `render_html` function. Please
        see the docstring of that function for further options that can control the
        aesthetic results.

    Returns
    -------

    """
    # Compute bounds and rescale the data map to a standard size
    raw_data_bounds = compute_percentile_bounds(data_map_coords)
    raw_data_width = raw_data_bounds[1] - raw_data_bounds[0]
    raw_data_height = raw_data_bounds[3] - raw_data_bounds[2]
    raw_data_scale = np.max([raw_data_width, raw_data_height])

    data_map_coords = (30.0 / raw_data_scale) * (
        data_map_coords - np.mean(data_map_coords, axis=0)
    )

    layers_to_process = label_layers[::-1]

    if len(layers_to_process) == 0:
        label_dataframe = pd.DataFrame(
            {
                "x": [data_map_coords.T[0].mean()],
                "y": [data_map_coords.T[1].mean()],
                "label": [noise_label],
                "size": [np.power(data_map_coords.shape[0], 0.25)],
                "layer_index": [0],  # Add layer_index
            }
        )
    else:
        label_dataframes_list = []

        # Prepare parent list for topic tree if enabled
        parents = [[]] if enable_topic_tree else None

        include_related_points = (
                enable_topic_tree and
                render_html_kwds.get("topic_tree_kwds", {}).get("button_on_click") is not None
        )

        for i, labels in enumerate(layers_to_process):
            df = label_text_and_polygon_dataframes(
                labels,
                data_map_coords,
                noise_label=noise_label,
                use_medoids=use_medoids,
                cluster_polygons=cluster_boundary_polygons,
                alpha=polygon_alpha,
                include_zoom_bounds=enable_topic_tree,
                include_related_points=include_related_points,
                parents=parents,
            )
            # Add the layer index
            df["layer_index"] = i
            label_dataframes_list.append(df)

        if enable_topic_tree and label_dataframes_list:
            # Mark the lowest layer (finest)
            label_dataframes_list[-1]["lowest_layer"] = True

        label_dataframe = pd.concat(label_dataframes_list)

    # Split out the noise labels (placeholders for topic tree) so we can make color palettes.
    #
    noise_label_dataframe = label_dataframe[label_dataframe["label"] == noise_label]
    label_dataframe = label_dataframe[label_dataframe["label"] != noise_label]

    if cvd_safer:
        cmap = colorcet.cm.CET_C2s
    if label_color_map is None:
        if cmap is None:
            palette = palette_from_datamap(
                data_map_coords,
                label_dataframe[["x", "y"]].values,
                hue_shift=palette_hue_shift,
                radius_weight_power=palette_hue_radius_dependence,
                theta_range=palette_theta_range,
            )
        else:
            palette = palette_from_cmap_and_datamap(
                cmap,
                data_map_coords,
                label_dataframe[["x", "y"]].values,
                radius_weight_power=palette_hue_radius_dependence,
                theta_range=palette_theta_range,
            )
        if not darkmode:
            text_palette = np.asarray(
                [
                    tuple(int(c * 255) for c in to_rgb(color))
                    for color in deep_palette(palette)
                ]
            )
        else:
            text_palette = np.asarray(
                [
                    tuple(int(c * 255) for c in to_rgb(color))
                    for color in pastel_palette(palette)
                ]
            )
        palette = [tuple(int(c * 255) for c in to_rgb(color)) for color in palette]
        color_map = {
            label: color for label, color in zip(label_dataframe.label, palette)
        }
    else:
        color_map = {
            label: tuple(int(c * 255) for c in to_rgb(color))
            for label, color in label_color_map.items()
        }
        if not darkmode:
            text_palette = np.asarray(
                [
                    tuple(int(c * 255) for c in to_rgb(color))
                    for color in deep_palette(
                        [label_color_map[label] for label in label_dataframe.label]
                    )
                ]
            )
        else:
            text_palette = np.asarray(
                [
                    tuple(int(c * 255) for c in to_rgb(color))
                    for color in pastel_palette(
                        [label_color_map[label] for label in label_dataframe.label]
                    )
                ]
            )
    if len(label_dataframe) > 0:
        if color_label_text or color_cluster_boundaries:
            label_dataframe["r"] = text_palette.T[0]
            label_dataframe["g"] = text_palette.T[1]
            label_dataframe["b"] = text_palette.T[2]
            label_dataframe["a"] = 64
        else:
            label_dataframe["r"] = 15 if not darkmode else 240
            label_dataframe["g"] = 15 if not darkmode else 240
            label_dataframe["b"] = 15 if not darkmode else 240
            label_dataframe["a"] = 64

        label_dataframe["label"] = label_dataframe.label.map(
            lambda x: textwrap.fill(x, width=label_wrap_width, break_long_words=False)
        )

    # Recombine noise label placeholders.
    label_dataframe = pd.concat([label_dataframe, noise_label_dataframe])

    point_dataframe = pd.DataFrame(
        {
            "x": data_map_coords.T[0],
            "y": data_map_coords.T[1],
        }
    )
    if hover_text is not None:
        point_dataframe["hover_text"] = np.asarray(hover_text)

    if marker_size_array is not None:
        point_dataframe["size"] = np.asarray(marker_size_array)

    if marker_color_array is None:
        color_vector = np.asarray(
            [tuple(int(c * 255) for c in to_rgb(noise_color))]
            * data_map_coords.shape[0],
            dtype=np.uint8,
        )
        for labels in reversed(label_layers):
            label_map = {n: i for i, n in enumerate(np.unique(labels))}
            if noise_label not in label_map:
                label_map[noise_label] = -1
            label_unmap = {i: n for n, i in label_map.items()}
            cluster_label_vector = np.asarray(pd.Series(labels).map(label_map))
            unique_non_noise_labels = [
                label for label in label_unmap if label != label_map[noise_label]
            ]
            for label in unique_non_noise_labels:
                color_vector[cluster_label_vector == label] = color_map[
                    label_unmap[label]
                ]
    else:
        color_vector = np.asarray(
            [
                tuple(int(c * 255) for c in to_rgb(color))
                for color in marker_color_array
            ],
            dtype=np.uint8,
        )

    point_dataframe["r"] = color_vector.T[0].astype(np.uint8)
    point_dataframe["g"] = color_vector.T[1].astype(np.uint8)
    point_dataframe["b"] = color_vector.T[2].astype(np.uint8)
    point_dataframe["a"] = np.uint8(180)
    if marker_alpha_array is not None:
        if (marker_alpha_array <= 1).all():
            marker_alpha_array *= 255
        point_dataframe["a"] = marker_alpha_array.astype(np.uint8)

    if render_html_kwds.get("data_prefix") is None:
        render_html_kwds["data_prefix"] = "datamap_data"

    return render_html(
        point_dataframe,
        label_dataframe,
        color_label_text=color_label_text,
        darkmode=darkmode,
        noise_color=noise_color,
        label_layers=label_layers,
        cluster_colormap=color_map | {noise_label: noise_color},
        enable_topic_tree=enable_topic_tree,
        histogram_enable_click_persistence=histogram_enable_click_persistence,
        noise_label=noise_label,
        **render_html_kwds,
    )
