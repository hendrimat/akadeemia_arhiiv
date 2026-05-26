/**
 * LassoSelectionTool class for implementing lasso selection functionality in a deck.gl application.
 */
class LassoSelectionTool {
    constructor(datamap) {
        this.datamap = datamap;
        this.selectionCallbacks = [];
        this.itemId = datamap.lassoSelectionItemId;

        this.selectionMode = false;
        this.isDrawing = false;
        this.lassoPolygon = [];
        this.quadTree = null;
        this.points = null;

        this.initCanvas();
        this.initQuadTree();

        // Bind methods to 'this' so we can add/remove them as listeners safely
        this._handleKeyDown = this._handleKeyDown.bind(this);
        this._handleKeyUp = this._handleKeyUp.bind(this);
        this._handleMouseDown = this._handleMouseDown.bind(this);
        this._handleMouseMove = this._handleMouseMove.bind(this);
        this._handleMouseUp = this._handleMouseUp.bind(this);

        this.initEventListeners();
    }

    initQuadTree() {
        // (Logic remains the same - correct)
        const scatterLayer = this.datamap.deckgl.props.layers.find(layer => layer instanceof deck.ScatterplotLayer);
        if (!scatterLayer) return;

        const { attributes } = scatterLayer.props.data;
        this.points = attributes.getPosition.value;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < this.points.length; i += 2) {
            minX = Math.min(minX, this.points[i]);
            maxX = Math.max(maxX, this.points[i]);
            minY = Math.min(minY, this.points[i + 1]);
            maxY = Math.max(maxY, this.points[i + 1]);
        }

        const numPoints = this.points.length / 2;
        const leafSize = Math.max(Math.ceil(Math.sqrt(numPoints)), 64);

        const boundary = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        this.quadTree = new QuadTree(boundary, leafSize);

        for (let i = 0; i < this.points.length / 2; i++) {
            this.quadTree.insert(this.points, i);
        }
    }

    initCanvas() {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');

        this.canvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            pointer-events: none;
            z-index: 1000;
            width: 100%;
            height: 100%;
        `;

        // Append to datamap container so it matches size/position automatically
        if (this.datamap.container) {
            this.datamap.container.appendChild(this.canvas);
            // Initial sizing
            this.resizeCanvas();
            // Handle Resize
            this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
            this.resizeObserver.observe(this.datamap.container);
        } else {
            document.body.appendChild(this.canvas);
        }
    }

    resizeCanvas() {
        if (this.datamap.container) {
            this.canvas.width = this.datamap.container.clientWidth;
            this.canvas.height = this.datamap.container.clientHeight;
        }
    }

    drawLasso(lassoPolygon) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (lassoPolygon.length < 2) return;

        this.ctx.beginPath();
        const viewport = this.datamap.deckgl.viewManager.getViewports()[0];

        lassoPolygon.forEach(({ x, y }, index) => {
            const [screenX, screenY] = viewport.project([x, y]);
            if (index === 0) this.ctx.moveTo(screenX, screenY);
            else this.ctx.lineTo(screenX, screenY);
        });

        this.ctx.closePath();
        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = 'rgba(0, 128, 255, 0.8)';
        this.ctx.stroke();
        this.ctx.fillStyle = 'rgba(0, 128, 255, 0.1)';
        this.ctx.fill();
    }

    registerSelectionHandler(callback) {
        this.selectionCallbacks.push(callback);
        return () => {
            this.selectionCallbacks = this.selectionCallbacks.filter(cb => cb !== callback);
        };
    }

    onLassoComplete(lassoPolygon) {
        if (!this.quadTree || !this.points || lassoPolygon.length < 3) {
            // Clear logic if lasso is invalid (single click)
            this.handleSelection([]);
            return;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const point of lassoPolygon) {
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);
        }

        let potentialIndices = this.quadTree.query({
          x: minX, y: minY, width: maxX - minX, height: maxY - minY
        }, this.points);

        let selectedPoints = [];
        // Ensure we have the basic set to compare against
        const basicSet = this.datamap.dataSelectionManager ?
                         this.datamap.dataSelectionManager.getBasicSelectedIndices() : new Set();

        // If basic set is empty, we select from ALL points.
        // If basic set has items, we ONLY select from intersections (Refining Selection).
        const selectFromAll = basicSet.size === 0;

        selectedPoints = potentialIndices.filter(index => {
            // 1. Filter by previous selection (if active)
            if (!selectFromAll && !basicSet.has(index)) return false;

            // 2. Geometric Check
            return this.isPointInPolygon(
                {x: this.points[index * 2], y: this.points[index * 2 + 1]},
                lassoPolygon
            );
        });

        this.handleSelection(selectedPoints);
    }

    handleSelection(selectedPoints) {
        if (selectedPoints.length === 0) {
            this.datamap.removeSelection(this.itemId);
        } else {
            this.datamap.addSelection(selectedPoints, this.itemId);
        }
        this.selectionCallbacks.forEach(cb => cb(selectedPoints));
    }

    isPointInPolygon(point, polygon) {
        let isInside = false;
        const { x, y } = point;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) isInside = !isInside;
        }
        return isInside;
    }

    setSelectionMode(enabled) {
        this.selectionMode = enabled;

        // CSS Logic: Pass-through clicks when disabled, Capture clicks when enabled
        // We toggle pointer-events on the CANVAS, not the stacks.
        this.canvas.style.pointerEvents = enabled ? 'all' : 'none';
        this.canvas.style.cursor = enabled ? 'crosshair' : 'default';

        // Toggle DeckGL interactions
        if (this.datamap.deckgl) {
            this.datamap.deckgl.setProps({
                controller: {
                    dragPan: !this.selectionMode,
                    dragRotate: !this.selectionMode,
                    scrollZoom: !this.selectionMode // Also disable zoom while drawing
                },
                getCursor: ({isDragging}) => this.selectionMode ? "crosshair" : (isDragging ? "grabbing" : "grab"),
            });
        }

        if (!enabled) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.lassoPolygon = [];
        }
    }

    // FIX: Get Coordinates relative to Canvas/Container
    getRelativeCoordinates(clientX, clientY) {
        const rect = this.datamap.container.getBoundingClientRect();
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }

    getSpatialCoordinates(clientX, clientY) {
        const { x, y } = this.getRelativeCoordinates(clientX, clientY);
        const viewport = this.datamap.deckgl.viewManager.getViewports()[0];
        return viewport.unproject([x, y]);
    }

    initEventListeners() {
        // Global keys are fine
        document.addEventListener('keydown', this._handleKeyDown);
        document.addEventListener('keyup', this._handleKeyUp);

        // Mouse events on the container/canvas
        // Use the container to ensure we catch events even if mouse leaves canvas briefly
        const target = this.datamap.container || document.body;

        target.addEventListener('mousedown', this._handleMouseDown);
        window.addEventListener('mousemove', this._handleMouseMove); // Window to catch dragging outside
        window.addEventListener('mouseup', this._handleMouseUp);     // Window to catch release outside
    }

    destroy() {
        // CLEANUP
        document.removeEventListener('keydown', this._handleKeyDown);
        document.removeEventListener('keyup', this._handleKeyUp);

        const target = this.datamap.container || document.body;
        target.removeEventListener('mousedown', this._handleMouseDown);
        window.removeEventListener('mousemove', this._handleMouseMove);
        window.removeEventListener('mouseup', this._handleMouseUp);

        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }

    // Event Handlers
    _handleKeyDown(e) {
        if (e.key === 'Shift' && !this.selectionMode) this.setSelectionMode(true);
    }
    _handleKeyUp(e) {
        if (e.key === 'Shift' && this.selectionMode) this.setSelectionMode(false);
    }
    _handleMouseDown(e) {
        if (this.selectionMode) {
            this.isDrawing = true;
            const [x, y] = this.getSpatialCoordinates(e.clientX, e.clientY);
            this.lassoPolygon = [{ x, y }];
        }
    }
    _handleMouseMove(e) {
        if (this.selectionMode && this.isDrawing) {
            const [x, y] = this.getSpatialCoordinates(e.clientX, e.clientY);
            this.lassoPolygon.push({ x, y });
            this.drawLasso(this.lassoPolygon);
        }
    }
    _handleMouseUp(e) {
        if (this.selectionMode && this.isDrawing) {
            this.isDrawing = false;
            const [x, y] = this.getSpatialCoordinates(e.clientX, e.clientY);
            this.lassoPolygon.push({ x, y });
            this.onLassoComplete(this.lassoPolygon);
            this.lassoPolygon = [];
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }
}