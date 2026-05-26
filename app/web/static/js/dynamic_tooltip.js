class DynamicTooltipManager {
    constructor(datamap, config) {
        this.config = {
            // Safely access metadata without crashing if undefined
            getIdentifier: ({ index }) => datamap?.metaData?.hover_text?.[index],
            fetchData: async (identifier) => { throw new Error("fetchData function not provided"); },
            formatContent: (data) => { throw new Error("formatContent function not provided"); },
            formatLoading: (identifier) => `<div style="padding:8px;">Loading data for <b>${identifier}</b>...</div>`,
            formatError: (error, identifier) => `<div style="color:red; padding:8px;">Error: ${error.message}</div>`,

            tooltipStyle: `
                position: absolute;
                display: none;
                z-index: 1000;
                pointer-events: none; /* Critical to prevent tooltip from stealing mouse events */
                transition: opacity 0.15s ease;
                opacity: 0;
            `,
            tooltipClassName: 'container-box deck-tooltip',
            initialHtml: '',
            useCache: true,
            ...config
        };

        this.datamap = datamap;
        this.tooltipElement = null;
        this.currentIdentifier = null;
        this.cache = new Map();

        // Track the active timeout to prevent race conditions
        this.hideTimeout = null;

        this._createTooltipElement();
        this._bindDeckHandlers();
    }

    _createTooltipElement() {
        this.tooltipElement = document.createElement('div');
        this.tooltipElement.className = this.config.tooltipClassName;
        this.tooltipElement.style.cssText = this.config.tooltipStyle;
        this.tooltipElement.innerHTML = this.config.initialHtml;

        // FIX 1: Append to the map container, not body.
        // This ensures info.x/y (relative to map) matches tooltip position.
        // Ensure container has 'position: relative' or 'absolute' in CSS.
        if (this.datamap.container) {
            this.datamap.container.appendChild(this.tooltipElement);
        } else {
            console.warn("DynamicTooltipManager: datamap container not found, defaulting to body.");
            document.body.appendChild(this.tooltipElement);
        }
    }

    _bindDeckHandlers() {
        // FIX 4: No polling. Bind immediately.
        // We check if metadata exists inside _handleHover.
        if (this.datamap && this.datamap.deckgl) {
            this.datamap.deckgl.setProps({
                onHover: this._handleHover.bind(this),
                getTooltip: null // Disable default tooltip
            });
        }
    }

    async _handleHover(info) {
        // 1. Stop any pending hide animation immediately
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }

        // 2. Validate Hover
        const objectExists = info.object || (info.index !== undefined && info.index !== -1);
        if (!objectExists) {
            this.hide();
            this.currentIdentifier = null;
            return;
        }

        // 3. Get Identifier
        const identifier = this.config.getIdentifier(info);
        if (!identifier) {
            // Hovering over a point that has no ID/Text? Hide.
            this.hide();
            return;
        }

        // 4. Position Tooltip
        // Since we appended to the container, info.x/y are correct.
        const { x, y } = info;
        this.tooltipElement.style.left = `${x + 10}px`; // Slight offset so cursor doesn't cover text
        this.tooltipElement.style.top = `${y + 10}px`;
        this.tooltipElement.style.display = 'block';

        // Force reflow to ensure transition triggers if previously hidden
        requestAnimationFrame(() => {
            this.tooltipElement.style.opacity = '1';
        });

        // 5. Data Logic
        // If we are already looking at this item, do nothing (just updated position above)
        if (this.currentIdentifier === identifier) {
            return;
        }

        // New Item Detected
        this.currentIdentifier = identifier;

        // Show Loading immediately
        this.tooltipElement.innerHTML = this.config.formatLoading(identifier);

        // CHECK CACHE
        if (this.config.useCache && this.cache.has(identifier)) {
            this.tooltipElement.innerHTML = this.config.formatContent(this.cache.get(identifier));
            return;
        }

        // FETCH DATA
        try {
            // FIX 2: No single 'isFetching' flag.
            // We capture the ID we are fetching *for* in a local variable (closure).
            const targetIdentifier = identifier;

            const data = await this.config.fetchData(targetIdentifier);

            // Save to cache
            if (this.config.useCache) {
                this.cache.set(targetIdentifier, data);
            }

            // FIX 2 continued: Concurrency Check
            // Only update UI if the user is STILL hovering over the same item
            // by the time the promise resolves.
            if (this.currentIdentifier === targetIdentifier) {
                this.tooltipElement.innerHTML = this.config.formatContent(data);
            }
        } catch (error) {
            console.error(`Tooltip Error for ${identifier}:`, error);
            if (this.currentIdentifier === identifier) {
                this.tooltipElement.innerHTML = this.config.formatError(error, identifier);
            }
        }
    }

    hide() {
        if (this.tooltipElement && this.tooltipElement.style.opacity !== '0') {
            this.tooltipElement.style.opacity = '0';

            // FIX 3: Prevent race condition.
            // Store the timeout ID so we can cancel it if the user hovers back in.
            this.hideTimeout = setTimeout(() => {
                this.tooltipElement.style.display = 'none';
                this.hideTimeout = null;
            }, 150);
        }
    }

    destroy() {
        if (this.tooltipElement && this.tooltipElement.parentNode) {
            this.tooltipElement.parentNode.removeChild(this.tooltipElement);
        }
        this.tooltipElement = null;
        this.cache.clear();
        if (this.hideTimeout) clearTimeout(this.hideTimeout);
    }
}