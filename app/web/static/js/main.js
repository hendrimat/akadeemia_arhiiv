// Configuration and DOM Caching
const API_BASE_URL = '';
const articleTemplate = document.getElementById('article-card-template');
const monthNavigatorTemplate = document.getElementById('month-navigator-template');
const articlesContainer = document.getElementById('articles-container');
const headerEl = document.querySelector('header');
const monthNavigatorContainer = document.getElementById('month-navigator-container');
const statusEl = document.getElementById("status");
const searchInput = document.getElementById('search-input');

// State Management
let allArticles = [];
let groupedArticles = {};
let sortedDates = []; // e.g., [{ year: 2023, months: [12, 11, ...] }, ...]
let currentYear;
let currentMonth;
let viewMode = 'browsing'; // 'browsing' or 'searching'
let isSearchLoading = false;

// Utility Functions
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

function groupArticlesByYearAndMonth(articles) {
    return articles.reduce((acc, article) => {
        const year = article.aasta;
        const month = article.kuu;
        if (!acc[year]) acc[year] = {};
        if (!acc[year][month]) acc[year][month] = [];
        acc[year][month].push(article);
        return acc;
    }, {});
}

// --- Data Preparation ---
function prepareNavigationData() {
    const years = Object.keys(groupedArticles).sort((a, b) => Number(b) - Number(a));
    sortedDates = years.map(year => ({
        year: Number(year),
        months: Object.keys(groupedArticles[year]).map(Number).sort((a, b) => Number(b) - Number(a))
    }));
}

// --- Core Rendering Functions ---
function createArticleElement(article, { isRecommendation = false } = {}) {
    const cardClone = articleTemplate.content.cloneNode(true);
    const cardWrapper = cardClone.querySelector('.article-card');
    const detailsEl = cardWrapper.querySelector('details');
    const markerEl = cardWrapper.querySelector('.details-marker');

    detailsEl.dataset.id = article.id;
    const titleEl = detailsEl.querySelector('[data-template="title"]');
    titleEl.textContent = article.pealkiri;
    detailsEl.querySelector('[data-template="author"]').textContent = article.autor;

    const infoEl = detailsEl.querySelector('[data-template="info"]');
    if (article.info) {
        infoEl.querySelector('em').textContent = article.info;
    } else {
        infoEl.remove();
    }

    if (article.has_pdf) {
        titleEl.classList.add('has-pdf');
        titleEl.dataset.pdfPath = article.file_path;
    }

    const detailsSection = detailsEl.querySelector('[data-template="details-section"]');
    if (article.abstrakt) {
        detailsSection.style.display = 'block';
        const abstractText = detailsEl.querySelector('[data-template="abstract"]');
        abstractText.textContent = article.abstrakt;
        abstractText.classList.add('is-clamped');
    } else {
        detailsSection.remove();
        markerEl.style.visibility = 'hidden';
        detailsEl.querySelector('.article-summary').style.pointerEvents = 'none';
    }

    const recsSection = detailsEl.querySelector('[data-template="recs-section"]');
    const gotoSection = detailsEl.querySelector('[data-template="goto-section"]');
    if (isRecommendation) {
        recsSection.remove();
        gotoSection.style.display = 'block';
        // gotoSection.querySelector('[data-template="goto-btn"]').dataset.targetId = article.id;
    } else {
        gotoSection.remove();
        if (article.create_embedding) {
            recsSection.style.display = 'block';
        } else {
            recsSection.remove();
        }
    }

    detailsEl.addEventListener('toggle', () => {
        markerEl.classList.toggle('is-open', detailsEl.open);
    });

    return cardClone;
}

/** Renders the view based on the current mode and state. */
function renderCurrentView() {
    if (viewMode === 'browsing') {
        renderMonthNavigator();
        monthNavigatorContainer.style.display = 'flex';
        const articlesForMonth = groupedArticles[currentYear]?.[currentMonth] || [];
        renderSingleMonth(articlesForMonth);
        // All conditional scrolling logic has been removed.
    } else { // 'searching' mode
        monthNavigatorContainer.style.display = 'none';
        // The search handler will call its own render function.
    }
}


/** Renders articles for a single month (browsing mode). */
function renderSingleMonth(articles) {
    const fragment = document.createDocumentFragment();
    articles.forEach(article => {
        fragment.appendChild(createArticleElement(article));
    });
    articlesContainer.replaceChildren(fragment);
    if (articles.length === 0) {
        articlesContainer.innerHTML = '<p style="text-align: center;">Sellel kuul artikleid ei leitud.</p>';
    }
}

/** Renders a list of articles with month headers (search mode). */
function renderSearchResults(articlesToRender) {
    if (articlesToRender.length === 0) {
        articlesContainer.innerHTML = '<p style="text-align: center;">Vastavaid artikleid ei leitud.</p>';
        return;
    }
    const fragment = document.createDocumentFragment();
    const articlesToDisplayGrouped = groupArticlesByYearAndMonth(articlesToRender);
    const sortedYears = Object.keys(articlesToDisplayGrouped).sort((a, b) => Number(b) - Number(a));
    let isFirstMonth = true;

    for (const year of sortedYears) {
        const sortedMonths = Object.keys(articlesToDisplayGrouped[year]).sort((a, b) => Number(b) - Number(a));
        for (const month of sortedMonths) {
            if (!isFirstMonth) {
                fragment.appendChild(document.createElement('hr'));
            }
            isFirstMonth = false;
            const monthHeader = document.createElement('h2');
            monthHeader.className = 'month-header';
            monthHeader.textContent = `${year} / ${String(month).padStart(2, '0')}`;
            fragment.appendChild(monthHeader);
            articlesToDisplayGrouped[year][month].forEach(article => {
                fragment.appendChild(createArticleElement(article));
            });
        }
    }
    articlesContainer.replaceChildren(fragment);
}


// --- Navigator ---

function renderMonthNavigator() {
    const navigatorClone = monthNavigatorTemplate.content.cloneNode(true);
    navigatorClone.querySelector('[data-template="year"]').textContent = currentYear;
    navigatorClone.querySelector('[data-template="month"]').textContent = String(currentMonth).padStart(2, '0');
    monthNavigatorContainer.replaceChildren(navigatorClone);
}


function handleNavigation(direction) {
    let currentYearIndex = sortedDates.findIndex(y => y.year === currentYear);
    let currentMonthIndex = sortedDates[currentYearIndex].months.findIndex(m => m === currentMonth);

    switch (direction) {
        case 'month-next':
            currentMonthIndex--; // Months are sorted descending
            if (currentMonthIndex < 0) {
                currentYearIndex--; // Years are sorted descending
                if (currentYearIndex < 0) currentYearIndex = sortedDates.length - 1; // Loop to last year
                currentMonthIndex = sortedDates[currentYearIndex].months.length - 1; // Last month of new year
            }
            break;
        case 'month-prev':
            currentMonthIndex++;
            if (currentMonthIndex >= sortedDates[currentYearIndex].months.length) {
                currentYearIndex++;
                if (currentYearIndex >= sortedDates.length) currentYearIndex = 0; // Loop to first year
                currentMonthIndex = 0; // First month of new year
            }
            break;
    }

    currentYear = sortedDates[currentYearIndex].year;
    currentMonth = sortedDates[currentYearIndex].months[currentMonthIndex];
    renderCurrentView();
}

function showSelector(type, targetElement) {
    // Remove any existing popups
    document.querySelector('.selector-popup')?.remove();

    const popup = document.createElement('div');
    popup.className = 'selector-popup';

    let items = [];
    if (type === 'year') {
        items = sortedDates.map(d => d.year);
    } else {
        const yearData = sortedDates.find(y => y.year === currentYear);
        items = yearData ? yearData.months.map(m => String(m).padStart(2, '0')) : [];
    }

    items.forEach(item => {
        const div = document.createElement('div');
        div.textContent = item;
        div.onclick = () => {
            if (type === 'year') {
                currentYear = Number(item);
                // Set to the first available month of the new year
                currentMonth = sortedDates.find(y => y.year === currentYear).months[0];
            } else {
                currentMonth = Number(item);
            }
            popup.remove();
            renderCurrentView();
        };
        popup.appendChild(div);
    });

    document.body.appendChild(popup);
    const rect = targetElement.getBoundingClientRect();
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom}px`;

    // Close popup if clicked outside
    setTimeout(() => {
        document.addEventListener('click', (e) => {
            if (!popup.contains(e.target) && e.target !== targetElement) {
                popup.remove();
            }
        }, { once: true });
    }, 0);
}

// --- Event Listeners ---

function setupNavigatorListeners() {
    monthNavigatorContainer.addEventListener('click', (e) => {
        const navTarget = e.target.dataset.nav;
        if (!navTarget) return;

        if (navTarget.endsWith('-select')) {
            const type = navTarget.split('-')[0]; // 'year' or 'month'
            showSelector(type, e.target);
        } else {
            handleNavigation(navTarget);
        }
    });
}

function setupArticleListeners() {
    articlesContainer.addEventListener('click', (e) => {
        const marker = e.target.closest('.details-marker');
        const summary = e.target.closest('summary.article-summary');
        const titleWithPdf = e.target.closest('[data-template="title"].has-pdf');
        const toggleAbstractBtn = e.target.closest(".toggle-abstract-btn");

        if (marker && !marker.closest('.similar-articles-trigger')) {
            const details = marker.closest('.article-card').querySelector('details[data-id]');
            if (details) details.open = !details.open;
        }
        if (summary) e.preventDefault();
        if (titleWithPdf) window.open(titleWithPdf.dataset.pdfPath, '_blank', 'noopener,noreferrer');
        if (toggleAbstractBtn) {
            const abstractText = toggleAbstractBtn.previousElementSibling;
            if (abstractText) {
                const isClamped = abstractText.classList.toggle('is-clamped');
                toggleAbstractBtn.textContent = isClamped ? 'Loe edasi' : 'Näita vähem';
            }
        }
    });

    articlesContainer.addEventListener('toggle', async (e) => {
        const recsContainer = e.target;
        if (!recsContainer.matches('.recommendations-container') || !recsContainer.open || recsContainer.dataset.loaded === 'true') {
            return;
        }
        recsContainer.dataset.loaded = 'true';

        const articleId = recsContainer.closest("details[data-id]").dataset.id;
        const recsList = recsContainer.querySelector(".recommendations-list");
        recsList.innerHTML = '<p>Otsin sarnaseid artikleid...</p>';

        try {
            const response = await fetch(`${API_BASE_URL}/api/recommendations/${articleId}`);
            if (!response.ok) throw new Error('Network error');
            const recommendations = await response.json();

            recsList.innerHTML = '';
            if (recommendations && recommendations.length > 0) {
                recommendations.slice(0, 5).forEach(rec => {
                    const fullArticleData = allArticles.find(a => a.id === rec.id);
                    if (fullArticleData) {
                        recsList.appendChild(createArticleElement(fullArticleData, { isRecommendation: true }));
                    }
                });
            } else {
                recsList.innerHTML = '<p>Soovitusi ei leitud.</p>';
            }
        } catch (err) {
            console.error("Failed to get recommendations:", err);
            recsList.innerHTML = '<p class="status-error">Soovituste laadimine ebaõnnestus.</p>';
        }
    }, true);
}


function setupSearchListener() {
    const handleSearch = async () => {
        const searchTerm = searchInput.value.trim();

        // If the search bar is cleared, revert to browsing mode
        if (searchTerm === '') {
            viewMode = 'browsing';
            renderCurrentView();
            return;
        }

        // Don't start a new search if one is already in progress
        if (isSearchLoading) {
            return;
        }

        viewMode = 'searching';
        monthNavigatorContainer.style.display = 'none';
        articlesContainer.innerHTML = '<p style="text-align: center;">Otsin...</p>'; // Show loading state
        isSearchLoading = true;

        try {
            // Call your new API endpoint
            const response = await fetch(`${API_BASE_URL}/api/search?q=${encodeURIComponent(searchTerm)}`);

            if (!response.ok) {
                throw new Error(`Network error: ${response.statusText}`);
            }

            const searchResults = await response.json();

            if (searchResults.error) {
                throw new Error(`API error: ${searchResults.error}`);
            }

            // The API returns partial article objects.
            // We need to map these results to the full article objects
            // we already have in the 'allArticles' array in memory.
            const fullArticles = searchResults.map(result => {
                // Find the full article data from our master list
                return allArticles.find(a => a.id === result.id);
            }).filter(Boolean); // .filter(Boolean) removes any undefined articles

            // Render the results using the full article objects
            renderSearchResults(fullArticles);

        } catch (err) {
            console.error("Search failed:", err);
            articlesContainer.innerHTML = '<p class="status-error" style="text-align: center;">Otsing ebaõnnestus. Proovi uuesti.</p>';
        } finally {
            isSearchLoading = false; // Allow new searches
        }
    };

    // We use debounce to wait until the user stops typing
    const debouncedSearch = debounce(handleSearch, 300);

    searchInput.addEventListener('input', () => {
        // We just trigger the debounced function.
        // The logic inside handleSearch checks the input value.
        debouncedSearch();
    });
}

// --- App Initialization ---
async function initializeApp() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/articles`);
        if (!response.ok) throw new Error('Network response was not ok');
        allArticles = await response.json();
        allArticles.sort((a, b) => {
            if (b.aasta !== a.aasta) return b.aasta - a.aasta;
            return b.kuu - a.kuu;
        });

        groupedArticles = groupArticlesByYearAndMonth(allArticles);
        prepareNavigationData();

        // Set initial state to the most recent month and year
        if (sortedDates.length > 0) {
            currentYear = sortedDates[0].year;
            currentMonth = sortedDates[0].months[0];
        }

        renderCurrentView();

        statusEl.textContent = `Kokku ${allArticles.length} artiklit.`;
        setupArticleListeners();
        setupNavigatorListeners();
        setupSearchListener();

    } catch (error) {
        console.error("Failed to fetch articles:", error);
        statusEl.textContent = "Viga: Serveriga ei saadud ühendust.";
        statusEl.classList.add("status-error");
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);
