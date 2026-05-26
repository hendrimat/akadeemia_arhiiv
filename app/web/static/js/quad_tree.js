/**
 * A QuadTree implementation for efficient spatial partitioning and querying.
 * Optimized for Float32Array input and zero-allocation queries.
 */
class QuadTree {
    /**
     * Creates a new QuadTree instance.
     * @param {Object} boundary - {x, y, width, height}
     * @param {number} capacity - Max points per bucket before split.
     * @param {number} maxDepth - Safety limit to prevent infinite recursion on duplicates.
     * @param {number} level - Current depth level (internal use).
     */
    constructor(boundary, capacity = 4, maxDepth = 10, level = 0) {
        this.boundary = boundary;
        this.capacity = capacity;
        this.maxDepth = maxDepth;
        this.level = level;

        this.points = []; // Stores indices
        this.divided = false;

        // Children
        this.northeast = null;
        this.northwest = null;
        this.southeast = null;
        this.southwest = null;
    }

    subdivide() {
        const x = this.boundary.x;
        const y = this.boundary.y;
        const w = this.boundary.width / 2;
        const h = this.boundary.height / 2;
        const nextLevel = this.level + 1;

        this.northeast = new QuadTree({ x: x + w, y: y, width: w, height: h }, this.capacity, this.maxDepth, nextLevel);
        this.northwest = new QuadTree({ x: x, y: y, width: w, height: h }, this.capacity, this.maxDepth, nextLevel);
        this.southeast = new QuadTree({ x: x + w, y: y + h, width: w, height: h }, this.capacity, this.maxDepth, nextLevel);
        this.southwest = new QuadTree({ x: x, y: y + h, width: w, height: h }, this.capacity, this.maxDepth, nextLevel);

        this.divided = true;

        // CRITICAL OPTIMIZATION:
        // Move existing points to children so this node becomes a pure branch.
        // This keeps queries faster (checking only leaves).
        for (const pIndex of this.points) {
            // We need to pass the raw coordinate lookups or a helper object to 'insert'
            // But since insert takes the whole float array, we manually redistribute:
            // Note: This requires we have access to the coords.
            // Since we don't store coords in the class, we must handle this differently.
            // See 'insert' below.
        }
    }

    /**
     * Inserts a point index.
     * @param {Float32Array} points - The raw coordinate array.
     * @param {number} index - The index of the point (i.e., point i starts at points[i*2]).
     */
    insert(points, index) {
        const px = points[index * 2];
        const py = points[index * 2 + 1];

        if (!this.containsPoint(px, py)) return false;

        // 1. If max depth reached, force insert (avoids crash on duplicates)
        if (this.points.length < this.capacity || this.level >= this.maxDepth) {
            // If we are already divided, we shouldn't hold points here in a "perfect" quadtree,
            // but for mixed-bucket usage, we push to children if possible.
            if (!this.divided) {
                this.points.push(index);
                return true;
            }
        }

        // 2. Split if needed
        if (!this.divided) {
            this.subdivide();

            // Redistribute existing points to children
            while (this.points.length > 0) {
                const existingIndex = this.points.pop();
                const ex = points[existingIndex * 2];
                const ey = points[existingIndex * 2 + 1];

                // We must manually check children because 'insert' signature relies on recursion
                if (this.northeast.insert(points, existingIndex)) continue;
                if (this.northwest.insert(points, existingIndex)) continue;
                if (this.southeast.insert(points, existingIndex)) continue;
                if (this.southwest.insert(points, existingIndex)) continue;
            }
        }

        // 3. Push to children
        if (this.northeast.insert(points, index)) return true;
        if (this.northwest.insert(points, index)) return true;
        if (this.southeast.insert(points, index)) return true;
        if (this.southwest.insert(points, index)) return true;

        return false; // Should not happen given containsPoint check
    }

    /**
     * @param {Object} range - {x, y, width, height}
     * @param {Float32Array} points - Raw coordinates
     * @param {Array} found - ACCUMULATOR (Performance Fix)
     */
    query(range, points, found = []) {
        if (!this.intersects(range)) return found;

        // Check points in this node
        for (const index of this.points) {
            const px = points[index * 2];
            const py = points[index * 2 + 1];
            if (this.rangeContainsPoint(range, px, py)) {
                found.push(index);
            }
        }

        // Recurse
        if (this.divided) {
            this.northeast.query(range, points, found);
            this.northwest.query(range, points, found);
            this.southeast.query(range, points, found);
            this.southwest.query(range, points, found);
        }

        return found;
    }

    // ... (containsPoint, intersects, rangeContainsPoint helper methods remain the same)
    containsPoint(x, y) {
        return (x >= this.boundary.x && x < this.boundary.x + this.boundary.width &&
            y >= this.boundary.y && y < this.boundary.y + this.boundary.height);
    }

    intersects(range) {
        return !(range.x > this.boundary.x + this.boundary.width ||
            range.x + range.width < this.boundary.x ||
            range.y > this.boundary.y + this.boundary.height ||
            range.y + range.height < this.boundary.y);
    }

    rangeContainsPoint(range, x, y) {
        return (x >= range.x && x < range.x + range.width &&
            y >= range.y && y < range.y + range.height);
    }
}