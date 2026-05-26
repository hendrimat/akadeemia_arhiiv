// Helper remains the same
var getNextSibling = function (elem, selector) {
    var sibling = elem.nextElementSibling;
    if (!selector) return sibling;
    while (sibling) {
        if (sibling.matches(selector)) return sibling;
        sibling = sibling.nextElementSibling
    }
};

function formatTopicTreeButtonHtml(icon, labelId) {
    return `<button class="topic-tree-btn" data-label-id="${labelId}">${icon}</button>`;
}

class TopicTree {
    constructor(
        topicTreeContainer,
        datamap,
        buttons,
        icon,
        options = {
            title: "Topic Tree",
            maxWidth: "30vw",
            maxHeight: "42vh",
            fontSize: "12pt",
            colorBullets: false,
        }
    ) {
        this.container = topicTreeContainer;
        this.datamap = datamap;

        this.colorBullets = options.colorBullets;
        this.maxWidth = options.maxWidth;
        this.maxHeight = options.maxHeight;
        this.title = options.title;
        this.fontSize = options.fontSize;
        this.elements = datamap.labelData || [];

        // State memory
        this.savedScrollTop = 0;
        this.isMobile = window.matchMedia("(max-width: 768px)").matches;

        const layers = this.elements.map(e => e.layer_no);
        this.rootLayerNo = layers.length ? Math.max(...layers) : 0;

        this.parentChildMap = this.buildParentChildMap();

        this.container.style.fontSize = this.fontSize;

        // --- DOM Construction ---

        // 1. Header
        this.header = document.createElement('div');
        this.header.classList.add('topic-tree-header');

        // Title
        this.heading = document.createElement('h3');
        this.heading.textContent = this.title;

        // Tools Container (Expand All + Toggle)
        this.toolsDiv = document.createElement('div');
        this.toolsDiv.classList.add('topic-tree-tools');

        // Expand All Button
        this.expandAllBtn = document.createElement('button');
        this.expandAllBtn.classList.add('expand-all-btn');
        this.expandAllBtn.dataset.expanded = 'false';
        this.expandAllBtn.textContent = 'Ava kõik';
        this.expandAllBtn.style.fontSize = '0.8em';

        // Toggle (Chevron) Button
        this.toggleBtn = document.createElement('button');
        this.toggleBtn.classList.add('topic-tree-toggle-btn');
        this.toggleBtn.innerHTML = '&#9660;'; // Down arrow
        this.toggleBtn.style.background = 'none';
        this.toggleBtn.style.border = 'none';
        this.toggleBtn.style.cursor = 'pointer';

        this.toolsDiv.appendChild(this.expandAllBtn);
        this.toolsDiv.appendChild(this.toggleBtn);

        this.header.appendChild(this.heading);
        this.header.appendChild(this.toolsDiv);

        // 2. Body
        this.topicTreeBody = document.createElement('div');
        this.topicTreeBody.classList.add('topic-tree-body');
        // Only apply max-width/height on desktop via inline styles
        if (!this.isMobile) {
            this.topicTreeBody.style.maxWidth = this.maxWidth;
            this.topicTreeBody.style.maxHeight = this.maxHeight;
        }
        this.topicTreeBody.innerHTML = this.buildTreeHtml(buttons, icon);

        // Assemble
        this.container.appendChild(this.header);
        this.container.appendChild(this.topicTreeBody);

        // Caches
        this.spanCache = new Map();
        this.parentChainCache = new Map();

        // Handlers
        this.setupCaretHandlers();
        this.setupLabelHandlers();
        this.setupExpandAllHandler();
        this.setupToggleHandler();

        this.initializeSpanCache();
        this.initializeParentChainCache();
        this.highlightElements(this.elements);

        // Initial Mobile State: Collapsed by default?
        // Or expanded? Let's leave expanded to show tags.
        // If you want it closed by default on mobile:
        // if (this.isMobile) this.toggleTree(false);
    }

    buildParentChildMap() {
        const parentChildMap = new Map();
        this.elements.forEach(element => {
            const parentId = element.parent;
            if (!parentChildMap.has(parentId)) {
                parentChildMap.set(parentId, []);
            }
            parentChildMap.get(parentId).push(element);
        });
        return parentChildMap;
    }

    buildTreeHtml(buttons, icon, parentId = 'base') {
        const children = this.parentChildMap.get(parentId) || [];
        if (children.length === 0) return '';

        return `
            <ul class="nested">
                ${children.map(label => `
                    <li>
                        <span 
                            class="${label.lowest_layer ? 'bullet' : 'caret'} ${label.id.endsWith('-1') ? 'unlabeled' : ''}" 
                            data-element-id="${label.id}" 
                            ${this.colorBullets ? `style="color: rgb(${label.r}, ${label.g}, ${label.b});"` : ''}
                        >
                        </span>${buttons ? formatTopicTreeButtonHtml(icon, label.id) : ''}
                        <span class="topic-tree-label" data-bounds="${JSON.stringify(label.bounds)}" data-label-id="${label.id}">
                            ${label.label || label.id}
                        </span>
                        ${this.buildTreeHtml(buttons, icon, label.id)}
                    </li>
                `).join('')}
            </ul>
        `;
    }

    setupLabelHandlers() {
        this.container.querySelectorAll('.topic-tree-label').forEach(button => {
            button.addEventListener('click', (e) => {
                const bounds = JSON.parse(e.currentTarget.dataset.bounds);
                this.datamap.flyToBounds(bounds);

                // --- MOBILE BEHAVIOR: Hide tree on click ---
                if (window.matchMedia("(max-width: 768px)").matches) {
                    this.toggleTree(false); // Collapse body
                }
            });
        });
    }

    setupToggleHandler() {
        // Toggle on chevron click
        this.toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent header click
            this.toggleTree();
        });

        // Also toggle on header click for easier mobile use
        this.header.addEventListener('click', () => {
            this.toggleTree();
        });

        this.expandAllBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't toggle the tree when clicking expand all
        });
    }

    toggleTree(forceState = null) {
        const body = this.topicTreeBody;
        const isCollapsed = body.classList.contains('collapsed');

        // Determine target state
        const shouldShow = forceState !== null ? forceState : isCollapsed;

        if (shouldShow) {
            // OPENING
            body.classList.remove('collapsed');
            this.toggleBtn.innerHTML = '&#9660;'; // Down arrow

            // Restore Memory
            body.scrollTop = this.savedScrollTop;
        } else {
            // CLOSING
            // Save Memory
            this.savedScrollTop = body.scrollTop;

            body.classList.add('collapsed');
            this.toggleBtn.innerHTML = '&#9664;'; // Left/Closed arrow
        }
    }

    initializeSpanCache() {
        this.spanCache.clear();
        this.container.querySelectorAll('[data-element-id]').forEach(span => {
            this.spanCache.set(span.dataset.elementId, span);
        });
    }

    initializeParentChainCache() {
        this.parentChainCache.clear();
        this.elements.forEach(element => {
            const chain = [];
            let current = element;
            while (current.parent) {
                chain.push(current.parent);
                current = this.elements.find(e => e.id === current.parent);
                if (!current) break;
            }
            this.parentChainCache.set(element.id, chain);
        });
    }

    highlightElements(elements) {
        const highlightedElements = Array.from(this.container.querySelectorAll('.highlighted'));
        highlightedElements.forEach(el => el.classList.remove('highlighted'));
        elements.forEach(element => {
            this.highlightElementAndParents(element);
        });
    }

    highlightElementAndParents(element) {
        const elementSpan = this.spanCache.get(element.id);
        if (!elementSpan) return;
        if (elementSpan.classList.contains('highlighted')) return;
        elementSpan.classList.add('highlighted');
        const parentChain = this.parentChainCache.get(element.id);
        if (parentChain) {
            for (const parentId of parentChain) {
                const parentSpan = this.spanCache.get(parentId);
                if (!parentSpan) continue;
                if (parentSpan.classList.contains('highlighted')) break;
                parentSpan.classList.add('highlighted');
            }
        }
    }

    setupCaretHandlers() {
        this.container.querySelectorAll('.caret').forEach(caret => {
            caret.addEventListener('click', function(e) {
                e.stopPropagation(); // Don't trigger label click
                this.classList.toggle('caret-down');
                const nestedList = getNextSibling(this, '.nested');
                if (nestedList) {
                    nestedList.classList.toggle('active');
                }
            });
        });
    }

    setupExpandAllHandler() {
        this.expandAllBtn.addEventListener('click', () => {
            const isExpanded = this.expandAllBtn.dataset.expanded === 'true';
            const carets = this.container.querySelectorAll('.caret');

            carets.forEach(caret => {
                const nestedList = getNextSibling(caret, '.nested');
                if (isExpanded) {
                    caret.classList.remove('caret-down');
                    if (nestedList) nestedList.classList.remove('active');
                } else {
                    caret.classList.add('caret-down');
                    if (nestedList) nestedList.classList.add('active');
                }
            });

            this.expandAllBtn.dataset.expanded = (!isExpanded).toString();
            this.expandAllBtn.textContent = isExpanded ? 'Ava kõik' : 'Sulge kõik';
        });
    }
}