const D3Histogram = (() => {
    /**
     * Checks if the input is a valid typed array.
     * @private
     */
    const isTypedArray = arr => {
        return arr instanceof Float32Array ||
            arr instanceof Float64Array ||
            arr instanceof Int8Array ||
            arr instanceof Uint8Array ||
            arr instanceof Uint8ClampedArray ||
            arr instanceof Int16Array ||
            arr instanceof Uint16Array ||
            arr instanceof Int32Array ||
            arr instanceof Uint32Array;
    }

    /**
     * Checks if a string is a valid date.
     * @private
     */
    const isValidDateStr = dateStr => !isNaN((new Date(dateStr)).getTime());

    /**
     * Builds a D3 histogram based on the provided data.
     */
    class D3Histogram {

        // Constants
        static DATA_TYPE_E = Object.freeze({
            NUMERICAL: 'number',
            CATEGORICAL: 'string',
            TEMPORAL: 'date'
        });

        static CLIP_BOUNDS_ID = "d3histogram-clipBounds";
        static BIN_RECT_CLASS_ID = "d3histogram-bin";
        static BIN_FOCUS_GROUP_ID = "d3histogram-focuscontainer";
        static BIN_FOCUS_RECT_CLASS_ID = "d3histogram-binFocus";
        static BIN_MIN_WIDTH = 10;
        static BIN_MAX_WIDTH = 30;
        static AXIS_CLASS_ID = 'd3histogram-axis';
        static XAXIS_GROUP_ID = 'd3histogram-xaxis';
        static YAXIS_GROUP_ID = 'd3histogram-yaxis';
        static XAXIS_TICKS_NB = 4;
        static YAXIS_TICKS_NB = 2;
        static INTERACTION_CONTAINER_ID = "d3histogram-interactioncontainer";

        /**
         * Static factory method for creating instances with validation.
         */
        static create({
            data,
            chartContainerId,
            chartWidth = 300,
            chartHeight = 70,
            title = '',
            binCount = -1,
            binDefaultFillColor = "#6290C3",
            binSelectedFillColor = "#2EBFA5",
            binUnselectedFillColor = "#9E9E9E",
            binContextFillColor = "#E6E6E6",
            logScale = false,
            enableClickPersistence = false,
            chartSelectionCallback = () => { }
        }) {

            // Parameter validation
            if (!chartContainerId) {
                console.error("D3Histogram Error: chart container ID was not provided.");
                return null;
            }

            // Ensure data structure is valid (checking for rawBinData presence)
            if (!data || !data.rawBinData || !Array.isArray(data.rawBinData) || data.rawBinData.length === 0) {
                console.error('D3Histogram Error: data must be a valid object containing rawBinData array.');
                return null;
            }

            try {
                return new D3Histogram({
                    data,
                    chartContainerId,
                    chartDimensions: {
                        width: chartWidth,
                        height: chartHeight,
                        margin: { top: 20, right: 5, bottom: 20, left: 20 }
                    },
                    title,
                    binCount,
                    binDefaultFillColor,
                    binSelectedFillColor,
                    binUnselectedFillColor,
                    binContextFillColor,
                    logScale,
                    enableClickPersistence,
                    chartSelectionCallback
                });
            } catch (error) {
                console.error("Error creating D3Histogram:", error);
                return null;
            }
        }

        /**
         * Constructor.
         * @private
         */
        constructor({
            data,
            chartContainerId,
            chartDimensions,
            title,
            binCount,
            binDefaultFillColor,
            binSelectedFillColor,
            binUnselectedFillColor,
            binContextFillColor,
            logScale,
            enableClickPersistence,
            chartSelectionCallback
        }) {
            // Define chart dimensions
            const { width, height, margin: { top, right, bottom, left } } = chartDimensions;
            const boundedWidth = width - left - right;
            const boundedHeight = height - top - bottom;

            // Store initial parameters and state
            this.state = {
                data: {
                    dataType: null,
                    rawData: data,
                    binsData: new Map(),
                    indicesData: new Int16Array(),
                    rawFocusData: null,
                    binsFocusData: null,
                    binCount: binCount != -1 ? binCount : null,
                    overallBinMin: null,
                    overallBinMax: null,
                },
                chart: {
                    chartContainerId: chartContainerId,
                    dimensions: {
                        ...chartDimensions,
                        boundedHeight,
                        boundedWidth
                    },
                    wrapper: null,
                    bounds: null,
                    binDefaultFillColor,
                    binSelectedFillColor,
                    binUnselectedFillColor,
                    binContextFillColor,
                    logScale,
                    binFocusDefaultFillColor: binDefaultFillColor,
                    binFocusSelectedFillColor: binSelectedFillColor,
                    binFocusUnselectedFillColor: binUnselectedFillColor,
                    chartSelectionCallback
                },
                peripherals: {
                    header: {
                        title: title.length !== 0 ? title : "",
                        subtitle: null,
                        titleDiv: null,
                        subtitleDiv: null,
                    },
                    axes: {
                        xAccessor: () => { },
                        yAccessor: () => { },
                        xScale: () => { },
                        yScale: () => { },
                        xAxis: () => { },
                        yAxis: () => { },
                        originalXScaleRange: null,
                    }
                },
                interactions: {
                    isBrushingActive: false,
                    brush: null,
                    prevBrushedDomain: null,
                    isPanningActive: false,
                    prevPanX: 0,
                    prevHoveredBinId: -1,
                    prevZoomK: 1,
                    isClickPersistenceEnabled: enableClickPersistence,
                    clickedBinId: -1,
                    isClickActive: false,
                    clickJustDeactivated: false
                }
            };

            this.#parseData();
            this.#drawCanvas();
            this.#drawChart();
            this.#initInteractions();
        }

        /**
         * Draws the chart based on the provided selected, focus indices.
         */
        drawChartWithSelection(selectedIndices) {
            this.#parseFocusData(selectedIndices);
            this.#drawFocusChart();
            this.#reset();
        }

        /**
         * Removes focus bounded data and bins.
         */
        removeChartWithSelection() {
            const { BIN_FOCUS_GROUP_ID: binsFocusGroupId } = D3Histogram;
            const { bounds } = this.state.chart;

            this.#clearFocusData();
            bounds.select(`#${binsFocusGroupId}`).remove();
            this.#reset();
        }

        /**
         * Clean up method to remove DOM elements and event listeners.
         */
        destroy() {
            const { chartContainerId } = this.state.chart;
            // Remove SVG
            d3.select(`#${chartContainerId} svg`).remove();
            // Remove Titles created outside SVG
            d3.select(`#${chartContainerId} #d3histogram-title`).remove();
            d3.select(`#${chartContainerId} #d3histogram-subtitle`).remove();

            this.state = null;
        }

        // **********************************************************************************
        //#region Data
        // **********************************************************************************

        #parseData() {
            const { DATA_TYPE_E } = D3Histogram;
            let { dataType, binsData, indicesData } = this.state.data;
            const { rawData } = this.state.data;
            const { rawBinData, rawIndexData } = rawData;

            const value = rawBinData[0].mean_value;

            if (typeof value === 'number') {
                dataType = DATA_TYPE_E.NUMERICAL;
            } else if (isValidDateStr(value)) {
                dataType = DATA_TYPE_E.TEMPORAL;
            } else {
                dataType = DATA_TYPE_E.CATEGORICAL;
            }

            rawBinData.forEach(bin => {
                const parsedBin = {
                    id: bin.id,
                    min: dataType === DATA_TYPE_E.TEMPORAL ? new Date(bin.min_value) : bin.min_value,
                    max: dataType === DATA_TYPE_E.TEMPORAL ? new Date(bin.max_value) : bin.max_value,
                    mean: dataType === DATA_TYPE_E.CATEGORICAL ? bin.id : bin.mean_value,
                    label: bin.mean_value,
                    indices: new Set(bin.indices)
                };
                binsData.set(bin.id, parsedBin);
            });

            indicesData = new Int16Array(rawIndexData["bin_id"]);

            this.state.data.dataType = dataType;
            this.state.data.binsData = binsData;
            this.state.data.indicesData = indicesData;
            this.state.data.binCount = binsData.size;
        }

        #parseFocusData(selectedIndices) {
            const { binsData, indicesData } = this.state.data;
            const rawFocusData = new Map();

            binsData.forEach(bin => {
                rawFocusData.set(bin.id, {
                    indices: new Set(),
                    binId: bin.id,
                    min: bin.min,
                    max: bin.max,
                    mean: bin.mean,
                    label: bin.label
                });
            });

            const selectedSet = new Set(selectedIndices);
            indicesData.forEach((binId, index) => {
                if (selectedSet.has(index)) {
                    rawFocusData.get(binId).indices.add(index);
                }
            });

            this.state.data.rawFocusData = rawFocusData;
            this.state.data.binsFocusData = rawFocusData;
        }

        #clearFocusData() {
            this.state.data.rawFocusData = null;
            this.state.data.binsFocusData = null;
        }

        //#endregion Data

        // **********************************************************************************
        //#region Chart
        // **********************************************************************************

        #drawCanvas() {
            const { chartContainerId, dimensions } = this.state.chart;
            const wrapper = d3.select(`#${chartContainerId}`)
                .append("svg")
                .attr("width", dimensions.width)
                .attr("height", dimensions.height);

            const bounds = wrapper.append("g")
                .style("transform", `translate(${dimensions.margin.left}px, ${dimensions.margin.top}px)`);

            this.state.chart.wrapper = wrapper;
            this.state.chart.bounds = bounds;
        }

        #drawChart() {
            const {
                CLIP_BOUNDS_ID, BIN_RECT_CLASS_ID, AXIS_CLASS_ID, XAXIS_GROUP_ID, YAXIS_GROUP_ID,
                XAXIS_TICKS_NB, YAXIS_TICKS_NB
            } = D3Histogram;
            const { dimensions, chartContainerId, bounds, binDefaultFillColor, logScale } = this.state.chart;
            const { title } = this.state.peripherals.header;
            const binsData = Array.from(this.state.data.binsData.values());
            let { overallBinMin, overallBinMax } = this.state.data;

            const xAccessor = d => d.mean;
            const yAccessor = d => d.indices.size;

            const xScale = d3.scaleBand()
                .domain(binsData.map(d => xAccessor(d)))
                .range([0, dimensions.boundedWidth])
                .padding(0.1);

            let yScale;
            if (logScale) {
                yScale = d3.scaleSymlog()
                    .domain([0, d3.max(binsData, yAccessor)])
                    .range([dimensions.boundedHeight, 0]);
            } else {
                yScale = d3.scaleLinear()
                    .domain([0, d3.max(binsData, yAccessor)])
                    .range([dimensions.boundedHeight, 0]);
            }

            this.state.peripherals.axes.originalXScaleRange = xScale.range();
            this.state.peripherals.axes.xAccessor = xAccessor;
            this.state.peripherals.axes.yAccessor = yAccessor;
            this.state.peripherals.axes.xScale = xScale;
            this.state.peripherals.axes.yScale = yScale;

            bounds.append("defs")
                .append("clipPath")
                .attr("id", CLIP_BOUNDS_ID)
                .append("rect")
                .attr("width", dimensions.boundedWidth)
                .attr("height", dimensions.boundedHeight);

            const binsGroup = bounds.append("g");
            binsGroup.selectAll("g")
                .data(binsData)
                .join("g")
                .append("rect")
                .attr("id", (_, i) => `${BIN_RECT_CLASS_ID}${i}`)
                .attr("class", BIN_RECT_CLASS_ID)
                .attr("x", d => xScale(xAccessor(d)))
                .attr("y", d => yScale(yAccessor(d)))
                .attr("width", xScale.bandwidth())
                .attr("height", d => dimensions.boundedHeight - yScale(yAccessor(d)))
                .attr("fill", binDefaultFillColor)
                .attr("clip-path", `url(#${CLIP_BOUNDS_ID})`);

            const yAxisTickFormat = d3.format(".1s");
            const yAxis = d3.axisRight(yScale)
                .ticks(logScale ? 2 * YAXIS_TICKS_NB : YAXIS_TICKS_NB)
                .tickFormat(d => d === yScale.domain()[0] ? '' : yAxisTickFormat(d));

            bounds.append("g")
                .attr("id", YAXIS_GROUP_ID)
                .attr("class", AXIS_CLASS_ID)
                .style("transform", `translate(-${dimensions.margin.left * .5}px, 0px)`)
                .call(yAxis);

            const xAxis = d3.axisBottom(xScale)
                .tickValues(this.#getAxisTickValues(xScale, XAXIS_TICKS_NB))
                .tickFormat(d => this.#getFormattedAxisTickValue(d));

            bounds.append("g")
                .attr("id", XAXIS_GROUP_ID)
                .attr("class", AXIS_CLASS_ID)
                .attr("transform", `translate(0,${dimensions.boundedHeight})`)
                .call(xAxis);

            const chartDiv = document.getElementById(chartContainerId);

            // Ensure title divs exist or reuse them
            let titleDiv = chartDiv.querySelector("#d3histogram-title");
            if(!titleDiv) {
                titleDiv = document.createElement('div');
                titleDiv.id = "d3histogram-title";
                chartDiv.appendChild(titleDiv);
            }
            d3.select(titleDiv).html(`<b>${title}</b>`);

            let subtitleDiv = chartDiv.querySelector("#d3histogram-subtitle");
            if(!subtitleDiv) {
                subtitleDiv = document.createElement('div');
                subtitleDiv.id = "d3histogram-subtitle";
                chartDiv.appendChild(subtitleDiv);
            }

            overallBinMin = Infinity;
            overallBinMax = -Infinity;
            binsData.forEach((binInfo) => {
                overallBinMin = Math.min(overallBinMin, binInfo.min);
                overallBinMax = Math.max(overallBinMax, binInfo.max);
            });
            const subtitle = this.#getSubtitle([overallBinMin, overallBinMax]);
            d3.select(subtitleDiv).html(subtitle);

            this.state.data.overallBinMin = overallBinMin;
            this.state.data.overallBinMax = overallBinMax;
            this.state.peripherals.axes.xAxis = xAxis;
            this.state.peripherals.axes.yAxis = yAxis;
            this.state.peripherals.header.title = title;
            this.state.peripherals.header.subtitle = subtitle;
            this.state.peripherals.header.titleDiv = titleDiv;
            this.state.peripherals.header.subtitleDiv = subtitleDiv;
        }

        #drawFocusChart() {
            const { CLIP_BOUNDS_ID, BIN_FOCUS_GROUP_ID, BIN_FOCUS_RECT_CLASS_ID } = D3Histogram;
            const { xAccessor, yAccessor, xScale, yScale } = this.state.peripherals.axes;
            const { binFocusDefaultFillColor, dimensions, bounds } = this.state.chart;
            let binsFocusData = Array.from(this.state.data.binsFocusData.values());

            bounds.select(`#${BIN_FOCUS_GROUP_ID}`).remove();

            const binsFocusGroup = bounds.append("g").attr("id", BIN_FOCUS_GROUP_ID);
            binsFocusGroup.selectAll("g")
                .data(binsFocusData)
                .join("g")
                .append("rect")
                .attr("id", (_, i) => `${BIN_FOCUS_RECT_CLASS_ID}${i}`)
                .attr("class", BIN_FOCUS_RECT_CLASS_ID)
                .attr("x", d => xScale(xAccessor(d)))
                .attr("y", d => yScale(yAccessor(d)))
                .attr("width", xScale.bandwidth())
                .attr("height", d => dimensions.boundedHeight - yScale(yAccessor(d)))
                .attr("fill", binFocusDefaultFillColor)
                .attr("clip-path", `url(#${CLIP_BOUNDS_ID})`);
        }

        #hasFocusChart = _ => this.state.data.rawFocusData !== null;

        #reset(preserveClick = false) {
            const {
                BIN_RECT_CLASS_ID, BIN_FOCUS_RECT_CLASS_ID,
                YAXIS_GROUP_ID, INTERACTION_CONTAINER_ID
            } = D3Histogram;
            const { overallBinMin, overallBinMax } = this.state.data;
            const { subtitleDiv } = this.state.peripherals.header;
            const { brush } = this.state.interactions;
            const { binDefaultFillColor, binContextFillColor, binFocusDefaultFillColor, chartSelectionCallback } = this.state.chart;
            let { isClickActive } = this.state.interactions;

            if (preserveClick && isClickActive) {
                d3.select(`#${INTERACTION_CONTAINER_ID}`).call(brush.clear);
                this.state.interactions.prevBrushedDomain = null;
                this.state.interactions.isBrushingActive = false;
                this.state.interactions.isPanningActive = false;
                this.state.interactions.prevHoveredBinId = -1;
                this.state.interactions.prevPanX = 0;
                d3.select(`#${YAXIS_GROUP_ID}`).raise();
                d3.select(`#${INTERACTION_CONTAINER_ID}`).raise();
                return;
            }

            d3.selectAll(`.${BIN_RECT_CLASS_ID}`).style("fill", this.#hasFocusChart() ? binContextFillColor : binDefaultFillColor);
            d3.selectAll(`.${BIN_FOCUS_RECT_CLASS_ID}`).style("fill", binFocusDefaultFillColor);

            chartSelectionCallback(null);

            const subtitle = this.#getSubtitle([overallBinMin, overallBinMax]);
            d3.select(subtitleDiv).html(subtitle);

            d3.select(`#${INTERACTION_CONTAINER_ID}`).call(brush.clear);

            // Reset interaction state
            const inter = this.state.interactions;
            inter.prevBrushedDomain = null;
            inter.isBrushingActive = false;
            inter.isPanningActive = false;
            inter.prevHoveredBinId = -1;
            inter.prevPanX = 0;
            inter.isClickActive = false;
            inter.clickedBinId = -1;

            d3.select(`#${YAXIS_GROUP_ID}`).raise();
            d3.select(`#${INTERACTION_CONTAINER_ID}`).raise();
        }

        //#endregion Chart

        // **********************************************************************************
        //#region Helpers (O(1) lookup)
        // **********************************************************************************

        /**
         * Manually inverts a scaleBand to find the domain value from a pixel coordinate.
         * @param {d3.ScaleBand} scale
         * @param {number} xPixel
         * @returns {any} The domain value (key)
         */
        #invertBandScale(scale, xPixel) {
            const domain = scale.domain();
            const range = scale.range();
            const paddingOuter = scale.paddingOuter();
            const step = scale.step();

            if (xPixel < range[0]) return domain[0];
            if (xPixel > range[1]) return domain[domain.length - 1];

            const index = Math.floor((xPixel - range[0] - paddingOuter * step) / step);
            return domain[Math.max(0, Math.min(index, domain.length - 1))];
        }

        /**
         * Finds the Bin ID (index) from a pixel coordinate using O(1) lookup.
         * @param {number} xPixel
         * @returns {number} The bin index or -1
         */
        #getBinIdFromPixel(xPixel) {
            const { xScale, xAccessor } = this.state.peripherals.axes;
            const { binsData, binsFocusData } = this.state.data;
            const data = this.#hasFocusChart() ? binsFocusData : binsData;

            // Get the mean value associated with this band position
            const meanValue = this.#invertBandScale(xScale, xPixel);

            // Since binsData is a Map, we convert to array to find index to match D3 selection index.
            // Optimization: If data is sorted, this could be binary search, but findIndex is better than O(N) calls on mousemove.
            // Since we need the *index* (0 to N) to match DOM IDs, we do this:
            const dataArr = Array.from(data.values());
            return dataArr.findIndex(d => xAccessor(d) === meanValue);
        }

        //#endregion Helpers

        // **********************************************************************************
        //#region Interactions
        // **********************************************************************************

        #initInteractions() {
            const { INTERACTION_CONTAINER_ID, BIN_MAX_WIDTH } = D3Histogram;
            const { dimensions, bounds } = this.state.chart;
            const { binCount } = this.state.data;

            // Brush
            const brush = d3.brushX()
                .extent([[0, 0], [dimensions.boundedWidth, dimensions.boundedHeight]])
                .filter(event => event.shiftKey || (event.type === 'mousedown' && event.detail > 1))
                .on("brush", e => this.#handleBrush(e))
                .on("end", e => this.#handleBrushEnd(e));

            bounds.append("g")
                .attr("id", INTERACTION_CONTAINER_ID)
                .call(brush);

            // Mouse Interactions
            d3.select(`#${INTERACTION_CONTAINER_ID}`)
                .on('mousedown', e => this.#handleMouseDown(e))
                .on('mouseup', e => this.#handleMouseUp(e))
                .on('mousemove', e => this.#handleMouseMove(e))
                .on('mouseleave', e => this.#handleMouseLeave(e))
                .on('click', e => this.#handleClick(e));

            // Zoom
            const maxK = (binCount * BIN_MAX_WIDTH) / dimensions.boundedWidth;
            const zoom = d3.zoom()
                .scaleExtent([1, maxK])
                .translateExtent([[0, 0], [dimensions.boundedWidth, dimensions.boundedHeight]])
                .extent([[0, 0], [dimensions.boundedWidth, dimensions.boundedHeight]])
                .filter(event => event.type === 'wheel')
                .on("zoom", e => this.#handleZoom(e));

            d3.select(`#${INTERACTION_CONTAINER_ID}`).call(zoom);

            this.state.interactions.brush = brush;
        }

        #handleBrush(e) {
            const { DATA_TYPE_E, BIN_RECT_CLASS_ID, BIN_FOCUS_RECT_CLASS_ID } = D3Histogram;
            const { binSelectedFillColor, binUnselectedFillColor, binContextFillColor, binFocusSelectedFillColor, binFocusUnselectedFillColor, chartSelectionCallback } = this.state.chart;
            const { xAccessor, xScale } = this.state.peripherals.axes;
            const { subtitleDiv } = this.state.peripherals.header;
            const { dataType, binsData, binsFocusData } = this.state.data;
            let { prevBrushedDomain } = this.state.interactions;

            if (dataType === DATA_TYPE_E.CATEGORICAL) { this.#removeBrush(); return; }
            if (!e.sourceEvent || !e.selection) return;

            this.state.interactions.isBrushingActive = true;

            // Efficient inversion using helper
            const x0 = this.#invertBandScale(xScale, e.selection[0]);
            const x1 = this.#invertBandScale(xScale, e.selection[1]);

            // Since scaleBand domain is discrete, we need to find bins between x0 and x1
            const data = this.#hasFocusChart() ? binsFocusData : binsData;
            const brushedBinIds = [];
            const brushedDomainBinned = [Infinity, -Infinity];
            const brushedBins = [];

            // Since we have start and end values, we can iterate once.
            // Note: xAccessor(d) returns the mean.
            data.forEach((d, i) => {
                const val = xAccessor(d);
                if (val >= x0 && val <= x1) {
                    brushedBinIds.push(i); // Assuming insertion order
                    brushedBins.push(d);
                    brushedDomainBinned[0] = Math.min(brushedDomainBinned[0], d.min);
                    brushedDomainBinned[1] = Math.max(brushedDomainBinned[1], d.max);
                }
            });

            if (prevBrushedDomain != null && prevBrushedDomain[0] === brushedDomainBinned[0] && prevBrushedDomain[1] === brushedDomainBinned[1]) return;
            this.state.interactions.prevBrushedDomain = brushedDomainBinned;

            d3.selectAll(`.${BIN_RECT_CLASS_ID}`)
                .style("fill", this.#hasFocusChart() ? binContextFillColor : (_, i) => brushedBinIds.includes(i) ? binSelectedFillColor : binUnselectedFillColor);

            d3.selectAll(`.${BIN_FOCUS_RECT_CLASS_ID}`)
                .style("fill", (_, i) => brushedBinIds.includes(i) ? binFocusSelectedFillColor : binFocusUnselectedFillColor);

            const subtitle = this.#getSubtitle(brushedDomainBinned);
            d3.select(subtitleDiv).html(subtitle);

            let brushedIndices = new Set();
            brushedBins.forEach(b => { brushedIndices = brushedIndices.union(b.indices); });
            chartSelectionCallback(brushedIndices);
        }

        #handleBrushEnd(e) {
            const { DATA_TYPE_E } = D3Histogram;
            if (this.state.data.dataType !== DATA_TYPE_E.CATEGORICAL && e.sourceEvent && !e.selection) {
                this.#reset();
            }
        }

        #removeBrush() {
            const { INTERACTION_CONTAINER_ID } = D3Histogram;
            d3.select(`#${INTERACTION_CONTAINER_ID}`).selectAll(".handle, .selection").style("display", "none");
        }

        #handleMouseDown(e) {
            if (this.state.interactions.isBrushingActive || e.button != 1) return;
            this.state.interactions.isPanningActive = true;
            this.state.interactions.prevPanX = e.clientX;
        }

        #handleMouseUp(e) {
            if (this.state.interactions.isBrushingActive || e.button != 1) return;
            this.state.interactions.isPanningActive = false;
        }

        #handleMouseMove(e) {
            const { isBrushingActive, isPanningActive } = this.state.interactions;
            if (isBrushingActive) return;
            if (isPanningActive) this.#handlePan(e);
            else this.#handleHover(e);
        }

        #handleMouseLeave(_) {
            const { isBrushingActive, isClickActive } = this.state.interactions;
            if (!isBrushingActive && !isClickActive) this.#reset();
        }

        #handleHover(e) {
            const { BIN_RECT_CLASS_ID, BIN_FOCUS_RECT_CLASS_ID } = D3Histogram;
            const { binSelectedFillColor, binUnselectedFillColor, binContextFillColor, binFocusSelectedFillColor, binFocusUnselectedFillColor, chartSelectionCallback } = this.state.chart;
            const { subtitleDiv } = this.state.peripherals.header;

            if (this.state.interactions.isClickActive || this.state.interactions.clickJustDeactivated) return;

            // Optimized O(1) lookup
            const xCoord = d3.pointer(e)[0];
            const hoveredBinId = this.#getBinIdFromPixel(xCoord);

            if (hoveredBinId === -1 || hoveredBinId === this.state.interactions.prevHoveredBinId) return;
            this.state.interactions.prevHoveredBinId = hoveredBinId;

            const binClassId = this.#hasFocusChart() ? BIN_FOCUS_RECT_CLASS_ID : BIN_RECT_CLASS_ID;
            const selection = d3.select(`#${binClassId}${hoveredBinId}`);
            if(selection.empty()) return;

            const hoveredBin = selection.data()[0];

            const subtitle = this.#getSubtitle([hoveredBin.min, hoveredBin.max]);
            d3.select(subtitleDiv).html(subtitle);

            d3.selectAll(`.${BIN_RECT_CLASS_ID}`)
                .style("fill", (_, i) => this.#hasFocusChart() ? binContextFillColor : i == hoveredBinId ? binSelectedFillColor : binUnselectedFillColor);

            d3.selectAll(`.${BIN_FOCUS_RECT_CLASS_ID}`)
                .style("fill", (_, i) => i == hoveredBinId ? binFocusSelectedFillColor : binFocusUnselectedFillColor);

            chartSelectionCallback(hoveredBin.indices);
        }

        #handlePan(e) {
            const { XAXIS_GROUP_ID, YAXIS_GROUP_ID, BIN_RECT_CLASS_ID, BIN_FOCUS_RECT_CLASS_ID } = D3Histogram;
            const { originalXScaleRange, xAccessor, yAccessor, xAxis, yAxis } = this.state.peripherals.axes;
            const { dimensions, wrapper } = this.state.chart;
            const { binsData } = this.state.data;
            let { xScale, yScale } = this.state.peripherals.axes;
            let { prevPanX } = this.state.interactions;

            const dX = e.clientX - prevPanX;
            this.state.interactions.prevPanX = e.clientX;

            let pannedRange = xScale.range().map(d => d + dX);
            if (pannedRange[1] < originalXScaleRange[1]) {
                pannedRange = [pannedRange[0] + originalXScaleRange[1] - pannedRange[1], originalXScaleRange[1]];
            } else if (pannedRange[0] > originalXScaleRange[0]) {
                pannedRange = [originalXScaleRange[0], pannedRange[1] - pannedRange[0] - originalXScaleRange[0]];
            }

            xScale.range(pannedRange);
            wrapper.select(`#${XAXIS_GROUP_ID}`).call(xAxis);

            const pannedDomain = originalXScaleRange.map(val => this.#invertBandScale(xScale, val));
            // Need to calculate min/max index from domain values to filter bins efficiently
            // Or just filter as before (Pan is less frequent than Hover, so Array.filter is acceptable here)
            const pannedBinsData = Array.from(binsData.values()).filter(d => xAccessor(d) >= pannedDomain[0] && xAccessor(d) <= pannedDomain[1]);

            yScale.domain([0, d3.max(pannedBinsData, yAccessor) || 1]);
            wrapper.select(`#${YAXIS_GROUP_ID}`).transition().call(yAxis);

            wrapper.selectAll(`.${BIN_RECT_CLASS_ID}, .${BIN_FOCUS_RECT_CLASS_ID}`)
                .attr("x", d => xScale(xAccessor(d)))
                .transition()
                .attr("y", d => yScale(yAccessor(d)))
                .attr("height", d => dimensions.boundedHeight - yScale(yAccessor(d)));
        }

        #handleZoom(e) {
            const { isBrushingActive } = this.state.interactions;
            const { dimensions, wrapper } = this.state.chart;
            const { binsData } = this.state.data;
            const { XAXIS_GROUP_ID, YAXIS_GROUP_ID, XAXIS_TICKS_NB, BIN_RECT_CLASS_ID, BIN_FOCUS_RECT_CLASS_ID } = D3Histogram;
            const { originalXScaleRange, xAccessor, yAccessor, xScale, yScale, xAxis, yAxis } = this.state.peripherals.axes;

            if (isBrushingActive || e.sourceEvent.type !== "wheel" || this.state.interactions.prevZoomK == e.transform.k) return;
            this.state.interactions.prevZoomK = e.transform.k;

            xScale.range([0, dimensions.boundedWidth].map(d => e.transform.applyX(d)));
            xAxis.tickValues(this.#getAxisTickValues(xScale, XAXIS_TICKS_NB * e.transform.k));
            wrapper.select(`#${XAXIS_GROUP_ID}`).transition().call(xAxis);

            const zoomedDomain = originalXScaleRange.map(val => this.#invertBandScale(xScale, val));
            const zoomedData = Array.from(binsData.values()).filter(d => xAccessor(d) >= zoomedDomain[0] && xAccessor(d) <= zoomedDomain[1]);

            yScale.domain([0, d3.max(zoomedData, yAccessor) || 1]);
            wrapper.select(`#${YAXIS_GROUP_ID}`).transition().call(yAxis);

            wrapper.selectAll(`.${BIN_RECT_CLASS_ID}, .${BIN_FOCUS_RECT_CLASS_ID}`)
                .transition()
                .attr("x", d => xScale(xAccessor(d)))
                .attr("y", d => yScale(yAccessor(d)))
                .attr("width", xScale.bandwidth())
                .attr("height", d => dimensions.boundedHeight - yScale(yAccessor(d)));
        }

        #handleClick(e) {
            const { isClickPersistenceEnabled } = this.state.interactions;
            if (!isClickPersistenceEnabled) return;

            const { BIN_RECT_CLASS_ID, BIN_FOCUS_RECT_CLASS_ID } = D3Histogram;
            const { chartSelectionCallback } = this.state.chart;
            const { subtitleDiv } = this.state.peripherals.header;
            let { clickedBinId, isClickActive } = this.state.interactions;

            // Optimized O(1) lookup
            const xCoord = d3.pointer(e)[0];
            const newClickedBinId = this.#getBinIdFromPixel(xCoord);

            if (newClickedBinId === -1) return;

            if (clickedBinId === newClickedBinId && isClickActive) {
                // Deselect
                this.state.interactions.isClickActive = false;
                this.state.interactions.clickedBinId = -1;
                this.state.interactions.clickJustDeactivated = true;

                chartSelectionCallback(null);
                this.#reset();

                setTimeout(() => { this.state.interactions.clickJustDeactivated = false; }, 100);
            } else {
                // Select
                this.state.interactions.isClickActive = true;
                this.state.interactions.clickedBinId = newClickedBinId;

                const binClassId = this.#hasFocusChart() ? BIN_FOCUS_RECT_CLASS_ID : BIN_RECT_CLASS_ID;
                const selection = d3.select(`#${binClassId}${newClickedBinId}`);
                if(selection.empty()) return;
                const clickedBin = selection.data()[0];

                chartSelectionCallback(clickedBin.indices);
                this.#updateBinColors(newClickedBinId);

                const subtitle = this.#getSubtitle([clickedBin.min, clickedBin.max]);
                d3.select(subtitleDiv).html(subtitle);
            }
        }

        #updateBinColors(selectedBinId) {
            const { BIN_RECT_CLASS_ID, BIN_FOCUS_RECT_CLASS_ID } = D3Histogram;
            const { binSelectedFillColor, binUnselectedFillColor, binContextFillColor, binFocusSelectedFillColor, binFocusUnselectedFillColor } = this.state.chart;

            d3.selectAll(`.${BIN_RECT_CLASS_ID}`)
                .style("fill", (_, i) => this.#hasFocusChart() ? binContextFillColor : i == selectedBinId ? binSelectedFillColor : binUnselectedFillColor);

            d3.selectAll(`.${BIN_FOCUS_RECT_CLASS_ID}`)
                .style("fill", (_, i) => i == selectedBinId ? binFocusSelectedFillColor : binFocusUnselectedFillColor);
        }

        //#endregion Interactions

        // **********************************************************************************
        //#region Peripherals
        // **********************************************************************************

        #getAxisTickValues = (scale, numTicks) => {
            const domain = scale.domain();
            const ticksInterval = Math.max(1, Math.floor(domain.length / numTicks));
            let tickValues;
            if (domain.length <= numTicks) {
                tickValues = domain;
            } else {
                tickValues = domain.filter((_, i) => i % ticksInterval === 0);
                while (tickValues.length < numTicks) tickValues.push(domain[domain.length - 1]);
            }
            return tickValues;
        };

        #getFormattedAxisTickValue(value) {
            const { DATA_TYPE_E } = D3Histogram;
            const { dataType } = this.state.data;
            if (dataType === DATA_TYPE_E.NUMERICAL) return this.#formatNumericalValue(value);
            if (dataType === DATA_TYPE_E.CATEGORICAL) return this.#formatCategoricalValue(value);
            if (dataType === DATA_TYPE_E.TEMPORAL) return this.#formatTemporalValue(value);
            return value;
        }

        #getSubtitle(range) {
            const { DATA_TYPE_E } = D3Histogram;
            const { dataType, binsData } = this.state.data;

            if (dataType === DATA_TYPE_E.CATEGORICAL) {
                const bin = binsData.get(range[0]);
                return (range[0] === range[1] && bin) ? `<b>${bin.label}</b>` : '';
            }

            let formattedRange;
            if (dataType === DATA_TYPE_E.NUMERICAL) formattedRange = range.map(d => this.#formatNumericalValue(d));
            else formattedRange = range.map(d => this.#formatTemporalValue(d));

            return `<b>${formattedRange[0]} — ${formattedRange[1]}</b>`;
        }

        #formatCategoricalValue(value) {
            const { xAccessor } = this.state.peripherals.axes;
            const { binsData } = this.state.data;
            const tickBin = Array.from(binsData.values()).find(b => xAccessor(b) === value);
            if (!tickBin) return value;
            const idx = tickBin.label.indexOf(' ');
            return idx !== -1 ? tickBin.label.slice(0, idx) : tickBin.label;
        }

        #formatNumericalValue(value) {
            const formatWithSI = d3.format(".4s");
            return formatWithSI(value).replace('µ', 'u').replace(/(\.[0-9]*[1-9])0+|\.0*([a-zA-Z]*)$/, '$1$2');
        }

        #formatTemporalValue(value) {
            const formatTime = d3.utcFormat("%m/%Y");
            return formatTime(new Date(value));
        }

        //#endregion Peripherals
    }

    return D3Histogram;
})();