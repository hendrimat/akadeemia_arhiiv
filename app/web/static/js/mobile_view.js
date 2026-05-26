let activeMobileViewId = null;

window.toggleMobileView = function(viewId) {
    const view = document.getElementById(viewId);
    const histBtn = document.getElementById('mobile-hist-btn');
    const cmapFace = document.querySelector('.color-map-selected-face');

    // If clicking the already open view, close it.
    if (activeMobileViewId === viewId) {
        view.classList.remove('active');
        if(viewId === 'histogram-view' && histBtn) histBtn.classList.remove('active');
        if(viewId === 'colormap-view' && cmapFace) cmapFace.parentElement.classList.remove('active-tab-bg');
        activeMobileViewId = null;
    } else {
        // Close Previous
        if (activeMobileViewId) {
            document.getElementById(activeMobileViewId).classList.remove('active');
            if(activeMobileViewId === 'histogram-view' && histBtn) histBtn.classList.remove('active');
            if(activeMobileViewId === 'colormap-view' && cmapFace) cmapFace.parentElement.classList.remove('active-tab-bg');
        }

        // Open New
        view.classList.add('active');
        if(viewId === 'histogram-view' && histBtn) histBtn.classList.add('active');
        if(viewId === 'colormap-view' && cmapFace) cmapFace.parentElement.classList.add('active-tab-bg');
        activeMobileViewId = viewId;

        // --- ADDED: Trigger Resize ---
        // This forces the chart to recalculate/redraw if it relies on container dimensions
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 50);
    }
};

function restructureColormapForMobile() {
    const colormapSelector = document.getElementById('colormap-selector-container');
    const colormapTabTarget = document.getElementById('mobile-colormap-tab-target');

    if (!colormapSelector || !colormapTabTarget) return;

    // 1. Move widget to tab bar
    colormapTabTarget.appendChild(colormapSelector);

    // 2. Wait for DOM content to be fully rendered by the Tool class
    const interval = setInterval(() => {
        const dropdown = colormapSelector.querySelector('.color-map-dropdown');
        // Select using IDs from your output HTML to be safe
        const swatch = document.getElementById('selectedColorSwatch');
        const text = document.getElementById('selectedColorMapText');
        const arrow = colormapSelector.querySelector('.dropdown-arrow');
        const optionsMenu = document.getElementById('colorMapOptions');
        const selectedBox = colormapSelector.querySelector('.color-map-selected');

        if (dropdown && swatch && text && arrow && selectedBox) {
            clearInterval(interval); // Stop checking

            // 3. DOM Surgery
            // Create the "Face" wrapper for Swatch + Text
            const faceContent = document.createElement('div');
            faceContent.className = 'color-map-selected-face';

            // Move elements into face
            faceContent.appendChild(swatch);
            faceContent.appendChild(text);

            // Clear the main box and re-append in split order
            selectedBox.innerHTML = '';
            selectedBox.appendChild(faceContent);
            selectedBox.appendChild(arrow);

            // 4. Remove the default "Click anywhere toggles dropdown" listener
            // We do this by cloning the dropdown node to strip generic listeners
            const newDropdown = dropdown.cloneNode(true);
            dropdown.parentNode.replaceChild(newDropdown, dropdown);

            // 5. Re-attach specific listeners to the NEW nodes
            const newFace = newDropdown.querySelector('.color-map-selected-face');
            const newArrow = newDropdown.querySelector('.dropdown-arrow');
            const newOptions = newDropdown.querySelector('.color-map-options');
            const newOptionsItems = newDropdown.querySelectorAll('.color-map-option');

            // Handler 1: Click Label -> Toggle Legend Body
            newFace.addEventListener('click', (e) => {
                e.stopPropagation();
                // Ensure dropdown options are closed
                newOptions.style.display = 'none';
                // Toggle the View
                toggleMobileView('colormap-view');
            });

            // Handler 2: Click Arrow -> Toggle Dropdown Options
            newArrow.addEventListener('click', (e) => {
                e.stopPropagation();
                const isHidden = newOptions.style.display === 'none';
                newOptions.style.display = isHidden ? 'block' : 'none';
            });

            // Handler 3: Click Option -> Close Menu
            newOptionsItems.forEach(opt => {
                opt.addEventListener('click', () => {
                    newOptions.style.display = 'none';
                    // Optional: Auto-open legend to show result
                    // if(activeMobileViewId !== 'colormap-view') toggleMobileView('colormap-view');
                });
            });
        }
    }, 50); // Check every 50ms
}

document.addEventListener('DOMContentLoaded', function() {
  const isMobile = window.matchMedia("(max-width: 768px)").matches;

  if (isMobile) {
    // Move Histogram
    const histContainer = document.getElementById('d3histogram-container');
    const histView = document.getElementById('histogram-view');
    if (histContainer && histView) histView.appendChild(histContainer);

    // Move Legend
    const legContainer = document.getElementById('legend-container');
    const cmapView = document.getElementById('colormap-view');
    if (legContainer && cmapView) cmapView.appendChild(legContainer);

    // Setup Colormap Split Button
    restructureColormapForMobile();
  }
});