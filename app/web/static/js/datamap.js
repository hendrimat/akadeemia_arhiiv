// ==========================================
// MODULE 1: UTILITIES (Math & Fonts)
// ==========================================

const FontUtils = {
    async waitForFont(fontName) {
        /* Force the browser to fetch the font and await its completion */
        try {
            await document.fonts.load(`12px "${fontName}"`);
        } catch (error) {
            console.warn(`Font ${fontName} failed to load:`, error);
        }
    }
};

class SpatialGrid {
  /**
   * Spatial Hash Grid for O(N) collision detection.
   * Replaces the O(N^2) nested loop logic.
   */
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.grid = new Map();
  }

  _getKey(x, y) {
    const gx = Math.floor(x / this.cellSize);
    const gy = Math.floor(y / this.cellSize);
    return `${gx},${gy}`;
  }

  insert(item) {
    const key = this._getKey(item.x, item.y);
    if (!this.grid.has(key)) {
      this.grid.set(key, []);
    }
    this.grid.get(key).push(item);
  }

  *getNeighbors(item) {
    const gx = Math.floor(item.x / this.cellSize);
    const gy = Math.floor(item.y / this.cellSize);

    // Check 3x3 grid around the item
    for (let x = gx - 1; x <= gx + 1; x++) {
      for (let y = gy - 1; y <= gy + 1; y++) {
        const cellItems = this.grid.get(`${x},${y}`);
        if (cellItems) {
          for (const neighbor of cellItems) {
            if (neighbor !== item) yield neighbor;
          }
        }
      }
    }
  }
}

// ==========================================
// MODULE 2: COLLISION LOGIC SERVICE
// ==========================================

class LabelThresholdCalculator {
  constructor(config) {
    this.viewportWidth = config.viewportWidth;
    this.viewportHeight = config.viewportHeight;
    this.fontFamily = config.fontFamily || 'Roboto';
    this.minSize = config.minSize || 12;

    this.ctx = document.createElement('canvas').getContext('2d');

    this.viewport = new deck.WebMercatorViewport({
      width: this.viewportWidth,
      height: this.viewportHeight,
      longitude: 0,
      latitude: 0,
      zoom: 0
    });
  }

  _measureDimensions(text, fontSize) {
    this.ctx.font = `400 ${fontSize}px ${this.fontFamily}`;
    const metrics = this.ctx.measureText(text);

    // Add padding (e.g., 4px total, so 2px per side)
    const padding = 4;

    return {
        width: metrics.width + padding,
        height: fontSize + padding, // Approximate height
        halfWidth: (metrics.width + padding) / 2,
        halfHeight: (fontSize + padding) / 2
    };
  }

  calculateThreshold(layerData) {
    if (!layerData || layerData.length < 2) return 0;

    let maxDimension = 0;

    // 1. Project and Measure
    const items = layerData.map(d => {
      const [px, py] = this.viewport.project([d.x, d.y]);
      const sizePx = d.size ? d.size : this.minSize;
      const dim = this._measureDimensions(d.label, Math.max(sizePx, this.minSize));

      // We track max dimension to set our spatial grid cell size
      if (dim.width > maxDimension) maxDimension = dim.width;

      return { x: px, y: py, ...dim };
    });

    // 2. Spatial Grid
    const grid = new SpatialGrid(maxDimension); // Use max width as cell size
    items.forEach(p => grid.insert(p));

    const requiredZooms = [];

    // 3. Check Rectangular Collisions
    for (const p1 of items) {
      for (const p2 of grid.getNeighbors(p1)) {
        // Avoid double checking
        if (p1.x >= p2.x) continue;

        // Delta in world pixels at Zoom 0
        const dx = Math.abs(p1.x - p2.x);
        const dy = Math.abs(p1.y - p2.y);

        // Combined half-sizes (the space needed to not touch)
        const reqW = p1.halfWidth + p2.halfWidth;
        const reqH = p1.halfHeight + p2.halfHeight;

        // Optimization: If they are already separated in either axis at Zoom 0, skip
        // (Though at Zoom 0 everything is usually overlapping, so this rarely triggers)
        if (dx > reqW || dy > reqH) continue;

        // Calculate zoom needed for X separation
        // Logic: CurrentDist * 2^Zoom = ReqDist  =>  2^Zoom = ReqDist / CurrentDist
        // We clamp dx/dy to a tiny number to avoid Infinity
        const zoomX = Math.log2(reqW / Math.max(dx, 0.00001));

        // Calculate zoom needed for Y separation
        const zoomY = Math.log2(reqH / Math.max(dy, 0.00001));

        // To be valid, we need to be separated in X OR Y.
        // So we need the minimum zoom that achieves EITHER separation.
        const pairThreshold = Math.min(zoomX, zoomY);

        requiredZooms.push(pairThreshold);
      }
    }

    if (requiredZooms.length === 0) return 0;

    // 4. Percentile Selection
    // 100th percentile (Max) guarantees NO overlaps.
    // 95th allows slight overlaps for better density.
    const sorted = new Float32Array(requiredZooms).sort();
    const percentileIndex = Math.floor(sorted.length*0.999); // 99.9% strictness

    return sorted[percentileIndex];
  }
}

// ==========================================
// MODULE 3: LAYER FACTORY
// ==========================================

const LayerFactory = {
  createPoints(id, dataAttributes, options, state) {
    const {
        pointSize, pointOutlineColor, pointLineWidth, pointHoverColor,
        pointLineWidthMaxPixels, pointLineWidthMinPixels,
        pointRadiusMaxPixels, pointRadiusMinPixels
    } = options;

    // Check if d3 is available globally, otherwise fallback
    const easing = (typeof d3 !== 'undefined' && d3.easeCubicInOut) ? d3.easeCubicInOut : null;

    return new deck.ScatterplotLayer({
      id,
      data: {
        length: state.numPoints,
        attributes: dataAttributes
      },
      getRadius: pointSize,
      getLineColor: pointOutlineColor,
      getLineWidth: pointLineWidth,
      highlightColor: pointHoverColor,
      lineWidthMaxPixels: pointLineWidthMaxPixels,
      lineWidthMinPixels: pointLineWidthMinPixels,
      radiusMaxPixels: pointRadiusMaxPixels,
      radiusMinPixels: pointRadiusMinPixels,
      radiusUnits: "common",
      lineWidthUnits: "common",
      autoHighlight: true,
      pickable: true,
      stroked: true,
      // Extensions
      extensions: [new deck.DataFilterExtension({ filterSize: 1 })],
      filterRange: [-0.5, 1.5],
      filterSoftRange: [0.75, 1.25],
      // State updates
      updateTriggers: {
        getFilterValue: state.updateTriggerCounter,
        radiusMinPixels: state.updateTriggerCounter,
        getFillColor: state.updateTriggerCounter
      },
      instanceCount: state.numPoints,
      parameters: { depthTest: false },
      // Animations
      transitions: easing ? {
        getFillColor: {
          duration: 1500,
          easing: easing
        }
      } : {}
    });
  },

  createEdges(id, attributes, options, numEdges) {
    return new deck.LineLayer({
      id,
      data: {
        length: numEdges,
        attributes: attributes
      },
      getSourcePosition: d => [d.source.x, d.source.y],
      getTargetPosition: d => [d.target.x, d.target.y],
      getWidth: options.edgeWidth,
    });
  },

  createBoundaries(id, data, options) {
    return new deck.PolygonLayer({
      id,
      data,
      stroked: true,
      filled: false,
      getLineColor: d => [d.r, d.g, d.b, d.a],
      getPolygon: d => d.polygon,
      lineWidthUnits: "common",
      getLineWidth: d => d.size * d.size,
      lineWidthScale: options.clusterBoundaryLineWidth * 5e-5,
      lineJointRounded: true,
      lineWidthMaxPixels: 4,
      lineWidthMinPixels: 0.0,
      instanceCount: data.length,
      parameters: { depthTest: false }
    });
  },

  createLabels(id, data, visible, options) {
    const {
      labelTextColor, textMinPixelSize, textMaxPixelSize,
      textOutlineWidth, textOutlineColor, textBackgroundColor,
      fontFamily, fontWeight, lineSpacing, pickable
    } = options;

    return new deck.TextLayer({
      id,
      visible,
      data,
      pickable,
      getPosition: d => [d.x, d.y],
      getText: d => d.label,
      getSize: d => d.size,
      getColor: labelTextColor,
      sizeScale: 1,
      sizeMinPixels: textMinPixelSize,
      sizeMaxPixels: textMaxPixelSize,
      outlineWidth: textOutlineWidth,
      outlineColor: textOutlineColor,
      getBackgroundColor: textBackgroundColor,
      getBackgroundPadding: [15, 15, 15, 15],
      background: true,
      characterSet: "auto",
      fontFamily: fontFamily,
      fontWeight: fontWeight,
      lineHeight: lineSpacing,
      fontSettings: {
          sdf: false
      },
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      elevation: 100,
      parameters: { depthTest: false }
    });
  },

  createImage(id, image, bounds) {
    return new deck.BitmapLayer({
        id,
        bounds,
        image,
        parameters: { depthTest: false }
    });
  }
};

// ==========================================
// MODULE 4: MAIN CONTROLLER
// ==========================================

function calculateZoomLevel(bounds, viewportWidth, viewportHeight, padding = 0.5) {
  const lngRange = bounds[1] - bounds[0];
  const latRange = bounds[3] - bounds[2];
  const centerLng = (bounds[0] + bounds[1]) / 2;
  const centerLat = (bounds[2] + bounds[3]) / 2;
  const zoomX = Math.log2(360 / (lngRange / (viewportWidth / 256)));
  const zoomY = Math.log2(180 / (latRange / (viewportHeight / 256)));
  const zoom = Math.min(zoomX, zoomY) - padding;
  return { zoomLevel: zoom, dataCenter: [centerLng, centerLat] };
}

class DataMap {
  constructor({
    container,
    bounds,
    searchItemId = "text-search",
    lassoSelectionItemId = "lasso-selection",
  }) {
    this.container = container;
    this.searchItemId = searchItemId;
    this.lassoSelectionItemId = lassoSelectionItemId;

    this.metaData = null;
    this.searchArray = [];
    this.layers = [];
    this.labelGroups = [];

    this.currentVisibleLabelIndex = -1;
    this.updateTriggerCounter = 0;
    this.selected = null;
    this.originalColors = null;
    this.pointConfig = {};

    // 1. State: Default to True
    this.showCollisionDebug = false;
    this.areLabelsVisible = true;

    const viewportWidth = this.container.clientWidth;
    const viewportHeight = this.container.clientHeight;
    const { zoomLevel, dataCenter } = calculateZoomLevel(bounds, viewportWidth, viewportHeight);

    this.internalViewState = {
      latitude: dataCenter[1],
      longitude: dataCenter[0],
      zoom: zoomLevel
    };

    this.thresholdCalculator = new LabelThresholdCalculator({
      viewportWidth,
      viewportHeight,
      fontFamily: "Josefin Sans"
    });

    this.deckgl = new deck.DeckGL({
      container: container,
      viewState: this.internalViewState,
      onViewStateChange: this._onViewStateChange.bind(this),
      controller: {
        scrollZoom: { speed: 0.01, smooth: true },
        inertia: true,
        dragRotate: false,
        touchRotate: false,
      },
    });

    window.addEventListener('resize', this._onResize.bind(this));

    if (typeof DataSelectionManager !== 'undefined') {
        this.dataSelectionManager = new DataSelectionManager(lassoSelectionItemId);
    } else {
        console.warn("DataSelectionManager not found. Selection features may fail.");
    }
  }

  /**
   * Toggles the visibility of text labels.
   * @param {boolean} isVisible - Whether labels should be shown.
   */
  toggleLabels(isVisible) {
    this.areLabelsVisible = isVisible;
    this._updateLayerList(); // Trigger a re-render immediately
  }

  _onViewStateChange({ viewState }) {
    this.internalViewState = viewState;
    const visibilityChanged = this._shouldSwitchLabelLayers(viewState.zoom);

    if (visibilityChanged) {
        this._updateLayerList();
    } else {
        this.deckgl.setProps({ viewState: this.internalViewState });
    }
  }

  _onResize() {
    const viewportWidth = this.container.clientWidth;
    const viewportHeight = this.container.clientHeight;

    this.thresholdCalculator.viewportWidth = viewportWidth;
    this.thresholdCalculator.viewportHeight = viewportHeight;

    this.deckgl.setProps({
        width: viewportWidth,
        height: viewportHeight
    });

    this._onViewStateChange({ viewState: this.internalViewState });
  }

  /**
   * Programmatically moves the camera to a new location.
   * @param {Object} viewState - { longitude, latitude, zoom }
   * @param {number} duration - Animation duration in ms
   */
  flyTo(viewState, duration = 1000) {
      this.internalViewState = {
          ...this.internalViewState,
          ...viewState,
          transitionDuration: duration,
          transitionInterpolator: new deck.FlyToInterpolator(),
          transitionEasing: (typeof d3 !== 'undefined') ? d3.easeCubic : undefined
      };

      this.deckgl.setProps({
          viewState: this.internalViewState
      });

      // Trigger a layer update immediately to ensure collision logic runs if needed
      this._onViewStateChange({ viewState: this.internalViewState });
  }

  /**
   * Calculates zoom level for bounds and flies there.
   * Encapsulates the math logic so external files don't need access to helper functions.
   */
  flyToBounds(bounds, padding = 0.5, duration = 1000) {
      // Use the internal helper functions available in this file's scope
      const viewportWidth = this.container.clientWidth;
      const viewportHeight = this.container.clientHeight;
      const { zoomLevel, dataCenter } = calculateZoomLevel(bounds, viewportWidth, viewportHeight, padding);

      this.flyTo({
          longitude: dataCenter[0],
          latitude: dataCenter[1],
          zoom: zoomLevel
      }, duration);
  }

  // ... [addPoints, addLabels, etc. remain the same] ...
  addPoints(pointData, options) {
    const { pointSize } = options;
    const numPoints = pointData.x.length;

    const positions = new Float32Array(numPoints * 2);
    const colors = new Uint8Array(numPoints * 4);
    const variableSize = pointSize < 0;
    const sizes = variableSize ? new Float32Array(numPoints) : null;

    for (let i = 0; i < numPoints; i++) {
      positions[i * 2] = pointData.x[i];
      positions[i * 2 + 1] = pointData.y[i];
      colors[i * 4] = pointData.r[i];
      colors[i * 4 + 1] = pointData.g[i];
      colors[i * 4 + 2] = pointData.b[i];
      colors[i * 4 + 3] = pointData.a[i];
      if (variableSize) sizes[i] = pointData.size[i];
    }

    this.originalColors = colors;
    this.selected = new Float32Array(numPoints).fill(1.0);
    this.pointConfig = { ...options, variableSize };

    this.pointAttributes = {
        getPosition: { value: positions, size: 2 },
        getFillColor: { value: colors, size: 4 },
        getFilterValue: { value: this.selected, size: 1 }
    };

    if (variableSize) {
        this.pointAttributes.getRadius = { value: sizes, size: 1 };
    }

    this.pointLayer = LayerFactory.createPoints(
        'dataPointLayer',
        this.pointAttributes,
        this.pointConfig,
        { numPoints, updateTriggerCounter: this.updateTriggerCounter }
    );
    this._addOrReplaceLayer(this.pointLayer);
  }

  async addLabels(labelDataArray, options) {
    if (!labelDataArray.length) return;

    const { fontFamily = "Josefin Sans", textMinPixelSize = 18, noiseLabel = "Outlier" } = options;

    this.thresholdCalculator.fontFamily = fontFamily;
    this.thresholdCalculator.minSize = textMinPixelSize;

    await FontUtils.waitForFont(fontFamily);

    console.time("Label Threshold Calculation");
    this.labelGroups = labelDataArray.map((data, i) => {
      const cleanData = data.filter(d => d.label !== noiseLabel);
      const threshold = this.thresholdCalculator.calculateThreshold(cleanData);
      return {
        id: `labelLayer-${i}`,
        data: cleanData,
        threshold: threshold,
        options: options
      };
    });
    console.timeEnd("Label Threshold Calculation");
    console.log("Zoom Thresholds:", this.labelGroups.map(g => g.threshold));

    this._shouldSwitchLabelLayers(this.internalViewState.zoom);
    this._updateLayerList();
  }

  _shouldSwitchLabelLayers(zoom) {
    if (!this.labelGroups.length) return false;
    let visibleIndex = 0;
    for (let i = this.labelGroups.length - 1; i >= 0; i--) {
      if (zoom >= this.labelGroups[i].threshold) {
        visibleIndex = i;
        break;
      }
    }
    if (visibleIndex !== this.currentVisibleLabelIndex) {
      console.log(`Switching labels: Layer ${visibleIndex} (Zoom > ${this.labelGroups[visibleIndex]?.threshold.toFixed(2)})`);
      this.currentVisibleLabelIndex = visibleIndex;
      return true;
    }
    return false;
  }

  addEdges(edgeData, options) {
    const numEdges = edgeData.r.length;
    const sourcePosition = new Float32Array(numEdges * 2);
    const targetPosition = new Float32Array(numEdges * 2);
    const colors = new Uint8Array(numEdges * 4);

    for (let i = 0; i < numEdges; i++) {
      sourcePosition[i * 2] = edgeData.x1[i];
      sourcePosition[i * 2 + 1] = edgeData.y1[i];
      targetPosition[i * 2] = edgeData.x2[i];
      targetPosition[i * 2 + 1] = edgeData.y2[i];
      colors[i * 4] = edgeData.r[i];
      colors[i * 4 + 1] = edgeData.g[i];
      colors[i * 4 + 2] = edgeData.b[i];
      colors[i * 4 + 3] = 180;
    }

    const attributes = {
      getSourcePosition: { value: sourcePosition, size: 2 },
      getTargetPosition: { value: targetPosition, size: 2 },
      getColor: { value: colors, size: 4 },
    };

    this.edgeLayer = LayerFactory.createEdges('edgeLayer', attributes, options, numEdges);
    this._addOrReplaceLayer(this.edgeLayer);
  }

  addBoundaries(boundaryData, options) {
    this.boundaryLayer = LayerFactory.createBoundaries('boundaryLayer', boundaryData, options);
    this._addOrReplaceLayer(this.boundaryLayer);
  }

  addBackgroundImage(image, bounds) {
    this.imageLayer = LayerFactory.createImage('imageLayer', image, bounds);
    this._addOrReplaceLayer(this.imageLayer);
  }

  addMetaData(metaData, { tooltipFunction, onClickFunction, searchField }) {
    this.metaData = metaData;
    this.tooltipFunction = tooltipFunction || (({index}) => this.metaData.hover_text[index]);
    this.onClickFunction = onClickFunction;
    this.searchField = searchField;

    const props = {};
    if (this.metaData.hasOwnProperty('hover_text')) props.getTooltip = this.tooltipFunction;
    if (this.onClickFunction) props.onClick = this.onClickFunction;

    this.deckgl.setProps(props);

    if (this.searchField) {
      this.searchArray = this.metaData[this.searchField].map(d => d.toLowerCase());
    }
  }

  _addOrReplaceLayer(newLayer) {
    const idx = this.layers.findIndex(l => l.id === newLayer.id);
    if (idx >= 0) {
        this.layers[idx] = newLayer;
    } else {
        this.layers.push(newLayer);
    }
    this._updateLayerList();
  }

  // 3. FIXED: Layer List Logic
  _updateLayerList() {
    const LAYER_ORDER = ['imageLayer', 'dataPointLayer', 'boundaryLayer', 'labelLayer', 'debug-collision-polygons'];

    // Filter out old labels AND old debug layers
    let finalLayers = this.layers.filter(l =>
        !l.id.startsWith('labelLayer') &&
        l.id !== 'debug-collision-polygons'
    );

    if (this.areLabelsVisible && this.labelGroups.length > 0 && this.currentVisibleLabelIndex >= 0) {
      const group = this.labelGroups[this.currentVisibleLabelIndex];

      // A. Create Active Label Layer
      const labelLayer = LayerFactory.createLabels(
        group.id,
        group.data,
        true,
        group.options
      );
      finalLayers.push(labelLayer);

      // B. Create Debug Polygon Layer
      if (this.showCollisionDebug) {
         // 1. Create a viewport for the current state to handle projections
         // We need the context's width/height, defaulting to window if not yet mounted
         const { clientWidth, clientHeight } = this.container;

         const currentViewport = new deck.WebMercatorViewport({
             ...this.internalViewState,
             width: clientWidth || 1000, // Fallback if container not ready
             height: clientHeight || 1000
         });

         const debugData = group.data.map(d => {
            const sizePx = d.size ? d.size : this.thresholdCalculator.minSize;

            // 1. Get the collision box dimensions in PIXELS
            const dim = this.thresholdCalculator._measureDimensions(
                d.label,
                Math.max(sizePx, this.thresholdCalculator.minSize)
            );

            const w = dim.width;
            const h = dim.height;

            // 2. Project the center world coordinates to pixel coordinates
            const [cx, cy] = currentViewport.project([d.x, d.y]);

            // 3. Calculate the 4 corners in Pixel Space
            // (Subtracting half width/height to center the box)
            const tl = currentViewport.unproject([cx - w/2, cy - h/2]); // Top-Left
            const tr = currentViewport.unproject([cx + w/2, cy - h/2]); // Top-Right
            const br = currentViewport.unproject([cx + w/2, cy + h/2]); // Bottom-Right
            const bl = currentViewport.unproject([cx - w/2, cy + h/2]); // Bottom-Left

            // 4. Return the polygon ring
            return {
                polygon: [tl, tr, br, bl]
            };
        });

        const debugPolygonLayer = new deck.PolygonLayer({
            id: 'debug-collision-polygons',
            data: debugData,
            getPolygon: d => d.polygon,
            getFillColor: [255, 0, 0, 40],    // Transparent Red Fill
            getLineColor: [255, 0, 0, 200],   // Solid Red Outline
            getLineWidth: 1,
            lineWidthUnits: 'pixels',
            stroked: true,
            filled: true,
            pickable: false,
            parameters: { depthTest: false }
        });

        finalLayers.push(debugPolygonLayer);
      }
    }

    // Sort
    finalLayers.sort((a, b) => {
      const getSortId = (layer) => {
          if (layer.id.startsWith('labelLayer')) return 'labelLayer';
          if (layer.id === 'debug-collision-polygons') return 'debug-collision-polygons';
          return layer.id;
      };
      return LAYER_ORDER.indexOf(getSortId(a)) - LAYER_ORDER.indexOf(getSortId(b));
    });

    // Reference tracking
    const pt = finalLayers.find(l => l.id === 'dataPointLayer');
    if (pt) this.pointLayer = pt;

    this.deckgl.setProps({
      viewState: this.internalViewState,
      layers: finalLayers
    });

    this.layers = finalLayers;
  }

  // ... [Keep remaining methods: connectHistogram, highlightPoints, etc.] ...
  connectHistogram(histogramItem) {
    this.histogramItem = histogramItem;
    this.histogramItemId = histogramItem.state.chart.chartContainerId;
  }

  async addSelectionHandler(callback, selectionKind = "lasso-selection", timeoutMs = 60000) {
    const startTime = Date.now();
    if (selectionKind === "lasso-selection") {
      while (!this.lassoSelector) {
        if (Date.now() - startTime > timeoutMs) throw new Error('Timeout: lassoSelector');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      this.lassoSelector.registerSelectionHandler(callback);
    } else {
      if (!this.selectionCallbacks) this.selectionCallbacks = {};
      (this.selectionCallbacks[selectionKind] ||= []).push(callback);
    }
  }

  highlightPoints(itemId) {
    if (!this.dataSelectionManager) return;

    const selectedIndices = this.dataSelectionManager.getSelectedIndices();
    const semiSelectedIndices = this.dataSelectionManager.getBasicSelectedIndices();
    const hasSelectedIndices = selectedIndices.size !== 0;
    const hasSemiSelectedIndices = semiSelectedIndices.size !== 0;
    const hasLassoSelection = this.dataSelectionManager.hasSpecialSelection();

    if (hasLassoSelection) {
      if (hasSelectedIndices) {
        if (hasSemiSelectedIndices) {
          this.selected.fill(-1.0);
          for (let i of semiSelectedIndices) this.selected[i] = 0.0;
        } else {
          this.selected.fill(0.0);
        }
        for (let i of selectedIndices) this.selected[i] = 1.0;
      } else {
        this.selected.fill(1.0);
      }
    } else {
        this.selected.fill(hasSelectedIndices ? -1.0 : 1.0);
        if (hasSelectedIndices) {
            for (let i of selectedIndices) this.selected[i] = 1.0;
        }
    }

    this.updateTriggerCounter++;

    const sizeAdjust = 1/(1 + (Math.sqrt(selectedIndices.size) / Math.log2(this.selected.length)));
    const newMinRadius = hasSelectedIndices
        ? 2 * (this.pointConfig.pointRadiusMinPixels + sizeAdjust)
        : this.pointConfig.pointRadiusMinPixels;

    const currentConfig = {
        ...this.pointConfig,
        pointRadiusMinPixels: newMinRadius
    };

    // FIX 3: Shallow clone pointAttributes to break reference equality.
    // This forces deck.gl to recognize that attributes have changed.
    this.pointAttributes = {
        ...this.pointAttributes,
        getFilterValue: { value: this.selected, size: 1 }
    };

    const updatedLayer = LayerFactory.createPoints(
        'dataPointLayer',
        this.pointAttributes,
        currentConfig,
        {
            numPoints: this.selected.length,
            updateTriggerCounter: this.updateTriggerCounter
        }
    );

    this._addOrReplaceLayer(updatedLayer);

    if (this.histogramItem && itemId !== this.histogramItemId) {
      hasSelectedIndices
        ? this.histogramItem.drawChartWithSelection(selectedIndices)
        : this.histogramItem.removeChartWithSelection(selectedIndices);
    }
  }

  addSelection(selectedIndices, selectionKind) {
    if (!this.dataSelectionManager) return;
    this.dataSelectionManager.addOrUpdateSelectedIndicesOfItem(selectedIndices, selectionKind);
    this.highlightPoints(selectionKind);
    this._triggerCallbacks(selectionKind);
  }

  removeSelection(selectionKind) {
    if (!this.dataSelectionManager) return;
    this.dataSelectionManager.removeSelectedIndicesOfItem(selectionKind);
    this.highlightPoints(selectionKind);
    this._triggerCallbacks(selectionKind);
  }

  _triggerCallbacks(selectionKind) {
    if (this.selectionCallbacks && this.selectionCallbacks[selectionKind] && this.dataSelectionManager) {
      const indices = Array.from(this.dataSelectionManager.getSelectedIndices());
      this.selectionCallbacks[selectionKind].forEach(cb => cb(indices));
    }
  }

  getSelectedIndices() {
    return this.dataSelectionManager ? this.dataSelectionManager.getSelectedIndices() : new Set();
  }

  searchText(searchTerm) {
    if (!this.dataSelectionManager) return;
    const term = searchTerm.toLowerCase();
    const indices = this.searchArray.reduce((acc, d, i) => {
      if (d.indexOf(term) >= 0) acc.push(i);
      return acc;
    }, []);

    if (searchTerm === "") {
      this.dataSelectionManager.removeSelectedIndicesOfItem(this.searchItemId);
    } else {
      this.dataSelectionManager.addOrUpdateSelectedIndicesOfItem(indices, this.searchItemId);
    }

    this._triggerCallbacks(this.searchItemId);
    this.highlightPoints(this.searchItemId);
  }

  recolorPoints(colorData, fieldName) {
    if (!this[`${fieldName}Colors`]) {
      const numPoints = colorData[`${fieldName}_r`].length;
      const colors = new Uint8Array(numPoints * 4);
      for (let i = 0; i < numPoints; i++) {
        colors[i * 4] = colorData[`${fieldName}_r`][i];
        colors[i * 4 + 1] = colorData[`${fieldName}_g`][i];
        colors[i * 4 + 2] = colorData[`${fieldName}_b`][i];
        colors[i * 4 + 3] = colorData[`${fieldName}_a`][i];
      }
      this[`${fieldName}Colors`] = colors;
    }

    this.pointAttributes.getFillColor = { value: this[`${fieldName}Colors`], size: 4 };
    this.updateTriggerCounter++;

    const updatedLayer = LayerFactory.createPoints(
        'dataPointLayer',
        this.pointAttributes,
        this.pointConfig,
        { numPoints: this.selected.length, updateTriggerCounter: this.updateTriggerCounter }
    );
    this._addOrReplaceLayer(updatedLayer);
  }

  resetPointColors() {
    this.pointAttributes.getFillColor = { value: this.originalColors, size: 4 };
    this.updateTriggerCounter++;

    const updatedLayer = LayerFactory.createPoints(
        'dataPointLayer',
        this.pointAttributes,
        this.pointConfig,
        { numPoints: this.selected.length, updateTriggerCounter: this.updateTriggerCounter }
    );
    this._addOrReplaceLayer(updatedLayer);
  }
}
