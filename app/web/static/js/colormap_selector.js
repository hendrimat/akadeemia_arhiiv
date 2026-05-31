// ==========================================
// HELPER: Colorbar (Visual Only) - HORIZONTAL VERSION
// ==========================================
class Colorbar {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            // CHANGED: Default to wider width, shorter height
            width: options.width || 300,
            height: options.height || 20,
            min: options.min || 0,
            max: options.max || 100,
            numTicks: options.numTicks || 5,
            colormap: options.colormap || ['blue', 'red'],
            label: options.label || '',
            dateFormat: options.dateFormat || 'short'
        };

        this.isDateScale = this.options.min instanceof Date ||
            (typeof this.options.min === 'string' && !isNaN(Date.parse(this.options.min)));

        if (this.isDateScale) {
            this.options.min = this.ensureDate(this.options.min);
            this.options.max = this.ensureDate(this.options.max);
            this.analyzeDateTimeRange();
        } else {
            this.analyzeNumericRange();
        }

        this.render();
    }

    // ... (Keep analyzeDateTimeRange, analyzeNumericRange, ensureDate, formatNumber, formatValue exactly as they were) ...
    analyzeDateTimeRange() {
        const { min, max } = this.options;
        const rangeMs = max.getTime() - min.getTime();
        const rangeHours = rangeMs / (1000 * 60 * 60);
        const rangeDays = rangeHours / 24;
        const rangeMonths = rangeDays / 30.44;
        const rangeYears = rangeMonths / 12;

        if (rangeYears >= 2) this.dateTimeFormat = { year: 'numeric', month: 'short' };
        else if (rangeMonths >= 2) this.dateTimeFormat = { month: 'short', day: 'numeric' };
        else if (rangeDays >= 2) this.dateTimeFormat = { month: 'short', day: 'numeric', hour: '2-digit' };
        else if (rangeHours >= 2) this.dateTimeFormat = { hour: '2-digit', minute: '2-digit' };
        else this.dateTimeFormat = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
    }

    analyzeNumericRange() {
        const { min, max } = this.options;
        this.isIntegerData = Number.isInteger(min) && Number.isInteger(max);
        const maxAbs = Math.max(Math.abs(min), Math.abs(max));
        const minAbs = Math.min(Math.abs(min), Math.abs(max));
        this.useScientific = maxAbs >= 1e5 || (minAbs > 0 && minAbs <= 1e-4);

        if (!this.isIntegerData && !this.useScientific) {
            const range = max - min;
            if (range < 1) this.decimals = 3;
            else if (range < 10) this.decimals = 2;
            else this.decimals = 1;
        }
    }

    ensureDate(value) { return value instanceof Date ? value : new Date(value); }

    formatNumber(value) {
        if (this.isIntegerData) return Math.round(value).toString();
        if (this.useScientific) return value.toExponential(2);
        if (Number.isInteger(value)) return value.toString();
        return value.toFixed(this.decimals);
    }

    formatValue(value) {
        if (this.isDateScale) {
            const date = value instanceof Date ? value : new Date(value);
            return this.options.dateFormat ?
                date.toLocaleDateString(undefined, this.options.dateFormat) :
                date.toLocaleString(undefined, this.dateTimeFormat);
        }
        return this.formatNumber(value);
    }

    createColorScale() {
        const { colormap } = this.options;
        if (colormap.length === 0) return 'none';
        if (colormap.length === 1) return colormap[0];
        // CHANGED: 'to top' -> 'to right' for horizontal
        return `linear-gradient(to right, ${colormap.join(', ')})`;
    }

    generateTicks() {
        const { min, max, numTicks } = this.options;
        const ticks = [];

        // CHANGED LOOP: Go from 0 to numTicks (Left to Right)
        for (let i = 0; i < numTicks; i++) {
            let value;
            const percent = i / (numTicks - 1); // 0.0 to 1.0

            if (this.isDateScale) {
                const minTime = min.getTime();
                const maxTime = max.getTime();
                value = new Date(minTime + percent * (maxTime - minTime));
            } else {
                value = min + percent * (max - min);
            }

            ticks.push({
                value: value,
                formattedValue: this.formatValue(value),
                // CHANGED: Position is simply the percentage (0% is left, 100% is right)
                position: percent * 100
            });
        }
        return ticks;
    }

    render() {
        this.container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'colorbar-container';
        // Note: Width is handled by CSS now, or you can set wrapper.style.width = this.options.width + 'px'

        // OPTIONAL: Put label on top or left.
        if (this.options.label) {
            const label = document.createElement('div');
            label.style.fontWeight = 'bold';
            label.style.marginBottom = '5px'; // Space between label and bar
            label.textContent = this.options.label;
            wrapper.appendChild(label);
        }

        const colorbar = document.createElement('div');
        colorbar.className = 'colorbar';
        colorbar.style.background = this.createColorScale();

        const tickContainer = document.createElement('div');
        tickContainer.className = 'colorbar-tick-container';

        this.generateTicks().forEach(tick => {
            const tickElement = document.createElement('div');
            tickElement.className = 'colorbar-tick';
            // CHANGED: Use 'left' instead of 'top'
            tickElement.style.left = `${tick.position}%`;

            const tickLine = document.createElement('div');
            tickLine.className = 'colorbar-tick-line';

            const tickLabel = document.createElement('div');
            tickLabel.className = 'colorbar-tick-label';
            tickLabel.textContent = tick.formattedValue;

            tickElement.appendChild(tickLine);
            tickElement.appendChild(tickLabel);
            tickContainer.appendChild(tickElement);
        });

        wrapper.appendChild(colorbar);
        wrapper.appendChild(tickContainer);
        this.container.appendChild(wrapper);
    }
}

function convertRGBtoObj(colorString) {
    const rgbKeys = ['r', 'g', 'b', 'a'];
    let rgbObj = {};
    let color = colorString.replace(/^rgba?\(|\s+|\)$/g, '').split(',');

    for (let i in rgbKeys)
        rgbObj[rgbKeys[i]] = parseInt(color[i]) || 1;

    return rgbObj;
}

class ColorLegend {
    constructor(container, datamap, colorData, colorField, options = {}) {
        this.container = container;
        this.options = {
            width: options.width || 400,
            colormap: options.colormap || { "High": "blue", "Low": "red" },
            label: options.label || ''
        };
        this.datamap = datamap;
        this.colorData = colorData;
        this.colorField = colorField;
        this.selectedItems = new Set();
        this.legendItems = [];
        this.render();
    }

    render() {
        this.container.innerHTML = '';

        for (const [label, color] of Object.entries(this.options.colormap)) {
            const legendItem = document.createElement('div');
            legendItem.className = 'legend-item';
            legendItem.style.cursor = 'pointer'; // Visual feedback

            const colorBox = document.createElement('div');
            colorBox.className = 'color-swatch-box';
            colorBox.style.borderRadius = "2px";
            colorBox.style.backgroundColor = color;

            const labelElement = document.createElement('div');
            labelElement.className = 'legend-label';
            labelElement.textContent = label;

            legendItem.appendChild(colorBox);
            legendItem.appendChild(labelElement);
            this.container.appendChild(legendItem);

            this.legendItems.push(legendItem);
        }

        // FIX: Calculate color on click, not on render
        this.container.addEventListener('click', (event) => {
            // 1. Find the clicked legend item (handles clicks on label or box)
            const item = event.target.closest('.legend-item');
            if (!item) return;

            // 2. Get the specific color box within this item
            const swatch = item.querySelector('.color-swatch-box');

            // 3. Compute style NOW (element is guaranteed visible, so this works)
            // This converts names like "blue" to "rgb(0, 0, 255)"
            const color = window.getComputedStyle(swatch).backgroundColor;

            // 4. Toggle Selection
            if (this.selectedItems.has(color)) {
                this.selectedItems.delete(color);
            } else {
                this.selectedItems.add(color);
            }

            // 5. Filter Data
            if (this.selectedItems.size > 0) {
                const selectedIndices = [];
                const targetColors = Array.from(this.selectedItems).map(c => convertRGBtoObj(c));

                const rArr = this.colorData[`${this.colorField}_r`];
                const gArr = this.colorData[`${this.colorField}_g`];
                const bArr = this.colorData[`${this.colorField}_b`];
                const len = rArr.length;

                // Use simple loop for performance
                for (let i = 0; i < len; i++) {
                    for (let j = 0; j < targetColors.length; j++) {
                        const target = targetColors[j];
                        // Compare R, G, B with tolerance (ignore Alpha)
                        if (Math.abs(rArr[i] - target.r) <= 1 &&
                            Math.abs(gArr[i] - target.g) <= 1 &&
                            Math.abs(bArr[i] - target.b) <= 1) {
                            selectedIndices.push(i);
                            break; // Found a match for this point, move to next point
                        }
                    }
                }
                this.datamap.addSelection(selectedIndices, "legend");
            } else {
                this.datamap.removeSelection("legend");
            }

            // 6. Update Visual Opacity
            this.legendItems.forEach((legendItem) => {
                const itemSwatch = legendItem.querySelector('.color-swatch-box');
                const itemColor = window.getComputedStyle(itemSwatch).backgroundColor;

                if (this.selectedItems.size === 0 || this.selectedItems.has(itemColor)) {
                    legendItem.style.opacity = 1;
                } else {
                    legendItem.style.opacity = 0.25;
                }
            });
        });
    }
}

// ==========================================
// CONTROLLER: Colormap Selector
// ==========================================
class ColormapSelectorTool {
    constructor(colorMaps, colorMapContainer, colorData, legendContainer, datamap, nColors = 3) {
        this.colorMaps = colorMaps;
        this.colorMapContainer = colorMapContainer;
        this.colorData = colorData;
        this.datamap = datamap;
        this.nColors = nColors;
        this.legendContainer = legendContainer;

        this.legendContainer.style.display = 'none';

        for (const colorMap of this.colorMaps) {
            if (Object.hasOwn(colorMap, "nColors")) {
                this.nColors = Math.max(this.nColors, colorMap.nColors);
            }
        }

        this.selectedColorMap = colorMaps[0];

        // Measurement div setup
        this.measureDiv = document.createElement("div");
        this.measureDiv.style.cssText = "position:absolute; visibility:hidden; white-space:nowrap;";
        document.body.appendChild(this.measureDiv);
        const maxWidth = this.calculateMaxWidth();

        // Build DOM
        this.buildDropdown(maxWidth);

        // Initial State
        this.updateSelectedColorMap();
        this.populateColorMapOptions();
        this.populateLegends();

        // Setup robust event listeners
        this.setupDelegatedListeners();

        if (this.measureDiv.parentNode) document.body.removeChild(this.measureDiv);
    }

    calculateMaxWidth() {
        let maxWidth = 0;
        this.measureDiv.className = "color-map-option";
        for (const colorMap of this.colorMaps) {
            this.measureDiv.innerHTML = `${this.createColorSwatch(colorMap.colors)} <span class="color-map-text">${colorMap.description}</span>`;
            maxWidth = Math.max(maxWidth, this.measureDiv.offsetWidth + 40);
        }
        return maxWidth;
    }

    buildDropdown(maxWidth) {
        this.colorMapDropdown = document.createElement("div");
        this.colorMapDropdown.className = "color-map-dropdown";
        this.colorMapDropdown.style.width = `${maxWidth}px`;

        const colorMapSelected = document.createElement("div");
        colorMapSelected.className = "color-map-selected";

        // We use IDs so we can find these again even if the DOM is cloned/moved
        this.selectedColorSwatch = document.createElement("span");
        this.selectedColorSwatch.className = "color-swatch";
        this.selectedColorSwatch.id = "selectedColorSwatch";

        this.selectedColorMapText = document.createElement("span");
        this.selectedColorMapText.className = "color-map-text";
        this.selectedColorMapText.id = "selectedColorMapText";

        const downArrow = document.createElement("span");
        downArrow.className = "dropdown-arrow";
        downArrow.innerHTML = "▼";
        downArrow.style.cursor = "pointer"; // Visual cue

        colorMapSelected.append(this.selectedColorSwatch, this.selectedColorMapText, downArrow);
        this.colorMapDropdown.appendChild(colorMapSelected);

        this.colorMapOptions = document.createElement("div");
        this.colorMapOptions.className = "color-map-options";
        this.colorMapOptions.id = "colorMapOptions";
        this.colorMapOptions.style.display = 'none';
        this.colorMapOptions.style.width = `${maxWidth}px`;

        this.colorMapDropdown.appendChild(this.colorMapOptions);
        this.colorMapContainer.appendChild(this.colorMapDropdown);
        this.colorMapContainer.style.width = `${maxWidth + 20}px`;
    }

    // FIX 1: Use Event Delegation
    // This listens to clicks on the whole document. If the click target looks like
    // our dropdown (or its options), we handle it. This works even if the elements
    // are cloned or replaced by the mobile script.
    setupDelegatedListeners() {
        document.addEventListener('click', (e) => {
            // Handle Arrow Click (Toggle Menu)
            if (e.target.classList.contains('dropdown-arrow')) {
                e.stopPropagation();
                // We need to find the options menu relative to the arrow clicked
                // (In case there are multiple, or it was moved)
                const wrapper = e.target.closest('.color-map-dropdown');
                if (wrapper) {
                    const options = wrapper.querySelector('.color-map-options');
                    if (options) {
                        const isHidden = options.style.display === 'none';
                        options.style.display = isHidden ? 'block' : 'none';
                    }
                }
                return;
            }

            // Handle Option Click (Select Colormap)
            const option = e.target.closest('.color-map-option');
            if (option) {
                // Ensure this is a real option (has an index)
                const index = option.dataset.index;
                if (index !== undefined) {
                    e.stopPropagation();
                    const colorMap = this.colorMaps[parseInt(index)];
                    if (colorMap) {
                        this.handleColorMapSelection(colorMap);
                    }

                    // Close the menu
                    const wrapper = option.closest('.color-map-dropdown');
                    if (wrapper) {
                        const options = wrapper.querySelector('.color-map-options');
                        if (options) options.style.display = 'none';
                    }
                }
                return;
            }

            // Handle Click Outside (Close Menu)
            // If we clicked somewhere that isn't the dropdown, close all open options
            if (!e.target.closest('.color-map-dropdown')) {
                const allOptions = document.querySelectorAll('.color-map-options');
                allOptions.forEach(opt => opt.style.display = 'none');
            }
        });
    }

    createColorSwatch(colors, categorical = false) {
        const n = Math.min(this.nColors, colors.length);
        let result = '<span class="color-swatch">';

        if (colors.length > 16 && !categorical) {
            const stepSize = (colors.length - 1) / (n - 1);
            for (let i = 0; i < colors.length; i += stepSize) {
                result += `<span class="color-swatch-box" style="background: ${colors[Math.round(i)]}"></span>`;
            }
        } else {
            for (let i = 0; i < n; i++) {
                result += `<span class="color-swatch-box" style="background: ${colors[Math.round(i)]}"></span>`;
            }
        }
        result += '</span>';
        return result;
    }

    handleColorMapSelection(colorMap) {
        this.selectedColorMap = colorMap;
        this.updateSelectedColorMap();

        if (colorMap.field === 'none') {
            this.datamap.resetPointColors();
            this.legendContainer.style.display = 'none';
        } else {
            this.datamap.recolorPoints(this.colorData, colorMap.field);

            const showLegend = ((colorMap.kind === "categorical") && ((colorMap.colors.length <= 20) || colorMap.showLegend) && Object.hasOwn(colorMap, "colorMapping")) ||
                               (colorMap.kind === "continuous") ||
                               (colorMap.kind === "datetime");

            if (showLegend) {
                this.legendContainer.style.display = 'block';
                Object.values(this.legends).forEach(l => l.style.display = 'none');
                if (this.legends[colorMap.field]) {
                    this.legends[colorMap.field].style.display = 'block';
                }
            } else {
                this.legendContainer.style.display = 'none';
            }
        }
    }

    updateSelectedColorMap() {
        // FIX 2: Robust DOM Lookup
        // We query by ID to ensure we find the element CURRENTLY in the DOM,
        // not the one we created in the constructor (which might have been removed/cloned).
        const swatch = document.getElementById("selectedColorSwatch");
        const text = document.getElementById("selectedColorMapText");

        if (swatch && text) {
            swatch.innerHTML = this.createColorSwatch(this.selectedColorMap.colors, this.selectedColorMap.kind === "categorical");
            text.innerHTML = this.selectedColorMap.description;
        }
    }

    populateColorMapOptions() {
        this.colorMapOptions.innerHTML = '';
        this.colorMaps.forEach((colorMap, index) => {
            const option = document.createElement("div");
            option.className = "color-map-option";
            // Store the index in the DOM so our delegated listener can find the data
            option.dataset.index = index;
            option.innerHTML = `<span class="color-map-text">${colorMap.description}</span> ${this.createColorSwatch(colorMap.colors, colorMap.kind === "categorical")}`;

            // Note: We do NOT add an event listener here anymore.
            // The setupDelegatedListeners() function handles it globally.

            this.colorMapOptions.appendChild(option);
        });
    }

    populateLegends() {
        this.legends = {};
        this.legendContainer.innerHTML = '';

        for (const colorMap of this.colorMaps) {
            if (colorMap.field === 'none') continue;

            const legendDiv = document.createElement("div");
            legendDiv.className = "color-legend-container";
            legendDiv.style.display = 'none';
            this.legends[colorMap.field] = legendDiv;

            if (colorMap.kind === "categorical" && ((colorMap.colors.length <= 20) || colorMap.showLegend) && Object.hasOwn(colorMap, "colorMapping")) {
                new ColorLegend(legendDiv, this.datamap, this.colorData, colorMap.field, { colormap: colorMap.colorMapping });
            } else if (colorMap.kind === "continuous") {
                new Colorbar(legendDiv, { colormap: colorMap.colors, label: colorMap.description, min: colorMap.valueRange[0], max: colorMap.valueRange[1] });
            } else if (colorMap.kind === "datetime") {
                new Colorbar(legendDiv, { colormap: colorMap.colors, label: colorMap.description, min: new Date(colorMap.valueRange[0]), max: new Date(colorMap.valueRange[1]), dateFormat: colorMap.dateFormat });
            }

            this.legendContainer.appendChild(legendDiv);
        }
    }
}