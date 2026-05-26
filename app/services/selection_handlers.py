
class SelectionHandlerBase:
    """Base class for selection handlers. Selection handlers are used to define custom behavior
    when text items are selected on the plot. This can include displaying additional information
    about the selected text items, generating visualizations based on the selected text items, or
    interacting with external APIs to process the selected text items.

    Parameters
    ----------
    dependencies : list, optional
        A list of URLs for external dependencies required by the selection handler. Default is an empty list.

    """

    def __init__(self, **kwargs):
        if "dependencies" in kwargs:
            self.dependencies = kwargs["dependencies"]
        else:
            self.dependencies = []

    @property
    def javascript(self):
        return ""

    @property
    def css(self):
        return ""

    @property
    def html(self):
        return ""



