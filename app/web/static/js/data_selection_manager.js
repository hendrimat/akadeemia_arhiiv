/**
 * DataSelectionManager is a class designed to manage the common selected indices across distinct items.
 */
class DataSelectionManager {
    constructor(specialItem) {
        this.excludeItem = specialItem; // The item key to exclude (e.g., 'lasso-selection')
        this.selectedIndicesByItem = {}; // Dictionary<string: itemId, Set: selectedIndices>
        this.selectedIndicesCommon = new Set(); // Intersection of ALL items
        this.selectedIndicesBasicCommon = new Set(); // Intersection of all items EXCEPT excludeItem
    }

    /**
     * Helper: Polyfill-like behavior for Set Intersection to ensure cross-browser compatibility
     * and safety against older environments.
     */
    _intersect(setA, setB) {
        // If native support exists, use it (fastest)
        if (typeof setA.intersection === 'function') {
            return setA.intersection(setB);
        }

        // Fallback for older browsers
        const _intersection = new Set();
        // Optimization: iterate over the smaller set
        const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];

        for (const elem of smaller) {
            if (larger.has(elem)) {
                _intersection.add(elem);
            }
        }
        return _intersection;
    }

    /**
     * Helper: Intersects an array of Sets
     */
    _intersectAll(sets) {
        if (sets.length === 0) return new Set();
        if (sets.length === 1) return sets[0];

        // Optimization: Sort by size, intersect starting with the smallest
        // This drastically reduces the number of comparisons.
        sets.sort((a, b) => a.size - b.size);

        let result = sets[0];
        for (let i = 1; i < sets.length; i++) {
            result = this._intersect(result, sets[i]);
            if (result.size === 0) return result; // Early exit
        }
        return result;
    }

    addOrUpdateSelectedIndicesOfItem(indices, itemId) {
        this.selectedIndicesByItem[itemId] = new Set(indices);
        this.#recalculate();
    }

    removeSelectedIndicesOfItem(itemId) {
        if (Object.prototype.hasOwnProperty.call(this.selectedIndicesByItem, itemId)) {
            delete this.selectedIndicesByItem[itemId];
            this.#recalculate();
        }
    }

    getSelectedIndices() {
        return this.selectedIndicesCommon;
    }

    getBasicSelectedIndices() {
        return this.selectedIndicesBasicCommon;
    }

    hasSpecialSelection() {
        return Object.prototype.hasOwnProperty.call(this.selectedIndicesByItem, this.excludeItem);
    }

    /**
     * Fully recalculates intersections.
     * This is cleaner and safer than incremental updates for this specific use case.
     * @private
     */
    #recalculate() {
        const allKeys = Object.keys(this.selectedIndicesByItem);

        // 1. Calculate Common (Intersection of ALL sets)
        const allSets = Object.values(this.selectedIndicesByItem);
        this.selectedIndicesCommon = this._intersectAll(allSets);

        // 2. Calculate Basic Common (Intersection of all sets EXCEPT excludeItem)
        const basicSets = [];
        for (const key of allKeys) {
            if (key !== this.excludeItem) {
                basicSets.push(this.selectedIndicesByItem[key]);
            }
        }

        // FIX: If no basic sets exist, it should be an empty set (not undefined)
        // BUT: In your datamap logic, "Basic" implies semi-selection.
        // If nothing is selected in basic items, the "Basic Intersection" is technically "Everything" or "Nothing" depending on philosophy.
        // Based on your previous logic: "if sets.length === 0 ... new Set()".
        this.selectedIndicesBasicCommon = this._intersectAll(basicSets);
    }
}