pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const PAGE_LOAD_RANGE = 5;
const HEADER_OFFEST = 118;

// General pdf
let loadedState = false;
let pdfPages = [];
let pageNum = 0;
let currentZoom = 1.0;
let originalPdfBytes = null;
let isExporting = false;
let originalFileName = 'document.pdf';

// Search
let currentSearchQuery = '';
let allMatches = [];
let currentMatchIndex = -1;

// Page dragging
let isDragging = false;
let currentClientX = 0;
let currentClientY = 0;
let dragPreview = null;
let draggedPageObj = null;

// Tools states
let activeTool = null;
let toolSize = 12;
let fontList = [
        'Arial', 
        'Arial Black',
        'Calibri', 
        'Comic Sans MS', 
        'Courier New', 
        'Georgia', 
        'Impact', 
        'Lucida Sans Unicode', 
        'Segoe UI',
        'Times New Roman', 
        'Trebuchet MS', 
        'Verdana'
    ];
let activeFont = null;
let activeColor = '#000000';

// Tool drawing
let isDrawingRect = false;
let isPainting = false;
let rectStartX = 0;
let rectStartY = 0;
let drawingPageObj = null;
let rectPreviewEl = null;
let currentPaintPath = "";
let paintPreviewSvg = null;
let paintPreviewPathNode = null;
let activeTextboxEl = null;
let activeTextPageObj = null;
let textStartX = 0;
let textStartY = 0;
let isCancelingText = false;

// Undo stack
const container = document.getElementById('pdf-container');
let undoStack = [];
const AppManager = {
    getPages: () => pdfPages,
    getContainer: () => container,
    refreshUI: () => {
        updatePageCount();
        updateMatchesList();
        loadPagesInRange();
    }
};
function executeAction(actionInstance) {
    actionInstance.execute();
    undoStack.push(actionInstance);
    //console.log(undoStack);
}

// Checking if the modern Query Local Fonts API is supported
initFonts();
async function initFonts() {
    if ('queryLocalFonts' in window) {
        try {
            // Asking for user's fonts list
            const availableFonts = await window.queryLocalFonts();
            fontList = [];
            
            // Extracting unique family names to avoid duplicates (e.g., Arial Bold, Arial Italic)
            const uniqueFamilies = new Set();
            availableFonts.forEach(font => {
                uniqueFamilies.add(font.family);
            });
            fontList = Array.from(uniqueFamilies);

            // Sorting fonts alphabetically
            fontList.sort();
            populateFonts();
        } catch (err) {
            console.warn("Local fonts access denied or failed, falling back to standard web fonts.", err);
            populateFonts();
        }
    } else {
        console.log("window.queryLocalFonts is not supported by this browser. Using fallbacks.");
        populateFonts();
    }
}


// Populating fonts selector
const fontOptionsContainer = document.getElementById('font-options');
function populateFonts() {
    fontList.forEach(fontName => {
        const option = document.createElement('option');
        option.value = fontName;
        option.textContent = fontName;
        fontOptionsContainer.appendChild(option);
    });

    // Setting default font to Arial if present, otherwise the first font
    activeFont = fontList.indexOf('Arial') !== -1 ? 'Arial' : fontList[0];
    fontOptionsContainer.value = activeFont;
}


let lang;
const LS_LANG = localStorage.getItem('lang');
if (!LS_LANG) {
    lang = 'EN';
} else {
    lang = LS_LANG;
}
const translations = {
    EN: {
        title: 'PDF Redactor',
        add: 'Add file',
        clear: 'Clear all',
        clearAllWarn: 'Clear all pages?',
        export: 'Export',
        exporting: 'Exporting...',
        exportErr: 'An error occurred while exporting the PDF.',
        langTip: 'Switch Language',
        pages: 'pages',
        pagesOf: 'of',
        redactAllTip: 'Redact all matches',
        searchPlacehold: 'Search...',
        matches: ' matches',
        searchPrevTip: 'Previous',
        searchNextTip: 'Next',
        sizeTip: 'Size',
        fontTip: 'Font Family',
        colorTip: 'Pick Color',
        rectToolTip: 'Rectangle Tool',
        paintToolTip: 'Paint Tool',
        textToolTip: 'Text Tool',
        zoomTip: 'Zoom Level',
        noPdfTitle: 'No PDF Loaded',
        noPdfLbl: 'Click to select a file or drag and drop it here',
        redactAllWarning: 'WARNING! Redact all is NOT guarenteed to find all instances of matching text, do not rely on it solely!',
        logoOne: 'Product of The Innovation and Information Management Department',
        logoTwo: 'Developed by Lee Ben Shmaryahu'
    },
    HE: {
        title: 'משחיר PDF',
        add: 'הוסף קובץ',
        clear: 'נקה הכל',
        clearAllWarn: 'נקה את כל הדפים?',
        export: 'ייצא',
        exporting: 'מייצא...',
        exportErr: 'שגיאה בייצוא הקובץ.',
        langTip: 'החלף שפה',
        pages: 'דפים',
        pagesOf: 'מתוך',
        redactAllTip: 'השחר את כל ההתאמות',
        searchPlacehold: 'חפש...',
        matches: ' התאמות',
        searchPrevTip: 'קודם',
        searchNextTip: 'הבא',
        sizeTip: 'גודל',
        fontTip: 'גופן',
        colorTip: 'בחר צבע',
        rectToolTip: 'כלי ריבועים',
        paintToolTip: 'כלי מברשת',
        textToolTip: 'כלי טקסט',
        zoomTip: 'רמת זום',
        noPdfTitle: 'קובץ PDF לא נטען',
        noPdfLbl: 'לחץ לבחירת קובץ או גרור קובץ לכאן',
        redactAllWarning: 'שימו לב! השחר הכל לא מחוייב למצוא את כל ההתאמות, אל תסתמכו עליו בלבד!',
        logoOne: 'מוצר של תחום החדשנות וניהול הידע',
        logoTwo: 'פותח ע"י לי בן שמריהו'
    }
};
applyLanguage(lang);

function applyLanguage(l=null) {
    // Toggling language if no language is provided
    if (!l) {
        l = lang === 'EN' ? 'HE' : 'EN';
    }

    lang = l;
    const t = translations[l];

    const html = document.documentElement;
    if (lang === 'EN') {
        html.dir = 'ltr';
        html.lang = 'en';
    } else {
        html.dir = 'rtl';
        html.lang = 'he';
    }

    // Saving language preference to local storage
    localStorage.setItem('lang', lang);
    
    document.documentElement.dir = l === 'HE' ? 'rtl' : 'ltr';
    document.getElementById('tab-title').innerText = t.title;
    document.getElementById('add-btn').innerText = t.add;
    document.getElementById('clear-btn').innerText = t.clear;
    document.getElementById('export-btn').innerText = t.export;
    document.getElementById('lang-btn').innerText = l;
    document.getElementById('lang-btn').dataset.tooltip = t.langTip;
    document.getElementById('pages-total-text').innerText = t.pages;
    document.getElementById('pages-total-text-of').innerText = t.pagesOf;
    document.getElementById('redact-all-btn').dataset.tooltip = t.redactAllTip;
    document.getElementById('search-bar').placeholder = t.searchPlacehold;
    document.getElementById('search-matches-text').innerText = t.matches;
    document.getElementById('search-prev-btn').dataset.tooltip = t.searchPrevTip;
    document.getElementById('search-next-btn').dataset.tooltip = t.searchNextTip;
    document.getElementById('size-selector').dataset.tooltip = t.sizeTip;
    document.getElementById('font-selector').dataset.tooltip = t.fontTip;
    document.getElementById('color-btn').dataset.tooltip = t.colorTip;
    document.getElementById('tool-rect-btn').dataset.tooltip = t.rectToolTip;
    document.getElementById('tool-paint-btn').dataset.tooltip = t.paintToolTip;
    document.getElementById('tool-text-btn').dataset.tooltip = t.textToolTip;
    document.getElementById('zoom-selector').dataset.tooltip = t.zoomTip;
    document.getElementById('no-pdf-title').innerText = t.noPdfTitle;
    document.getElementById('no-pdf-lbl').innerText = t.noPdfLbl;
    document.getElementById('logo-line-1').innerText = t.logoOne;
    document.getElementById('logo-line-2').innerText = t.logoTwo;
}


// Detecting when a new page is observed
const PAGE_NUM_INPUT = document.getElementById('page-num-input');
const observerOptions = {
    root: document.getElementById('pdf-container'),
    threshold: 0.5
};
const pageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            // Finding index of page in pages list
            const pageIndex = pdfPages.findIndex(p => p.id === entry.target.id);

            if (pageIndex !== -1) {
                pageNum = pageIndex + 1;
                PAGE_NUM_INPUT.value = pageNum;
                loadPagesInRange();
            }
        }
    });
}, observerOptions);


// Loading new pages from pdf file
async function loadPDF(file) {
    // Saving file name
    originalFileName = file.name || 'document.pdf';

    // Converting file to ArrayBuffer for local processing and loading the document
    const arrayBuffer = await file.arrayBuffer();
    originalPdfBytes = arrayBuffer.slice(0);
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const lastPageIndex = pdfPages.length;

    changeStateLoaded(true);
    executeAction(new AddFileAction(pdfPages.length));

    // Iterating through pages and adding them to the pages list
    for (let i = 1; i <= pdf.numPages; i++) {
        const pageProxy = await pdf.getPage(i);
        const viewport = pageProxy.getViewport({ scale: currentZoom });

        const id = `page-${Date.now()}-${i}`;

        // Creating page parent wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';

        // Creating page element
        const pageEl = document.createElement('div');
        pageEl.className = 'pdf-page-skeleton';
        pageEl.id = id;
        
        // Setting box size to match page size
        pageEl.style.width = `${viewport.width}px`;
        pageEl.style.height = `${viewport.height}px`;

        // Creating right sidebar element container
        const sidebarEl = document.createElement('div');
        sidebarEl.className = 'pdf-page-sidebar';
        sidebarEl.style.height = `${viewport.height}px`;

        // Page number
        const numIndicator = document.createElement('div');
        numIndicator.className = 'sidebar-page-num';

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'sidebar-delete-btn';
        deleteBtn.innerHTML = '<img src="./assets/trash-icon.svg" style="width: 50px; height: 50px;" alt="icon">';
        deleteBtn.dataset.pageId = id;
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            executeAction(new DeletePageAction(id));
        });

        // Drag Handler
        const dragHandle = document.createElement('div');
        dragHandle.className = 'sidebar-drag-handle';
        dragHandle.innerHTML = '<img src="./assets/drag-icon.svg" style="width: 30px; height: 30px;" alt="icon" draggable="false">';

        // Attaching custom dragging listener
        dragHandle.addEventListener('mousedown', (e) => {
            const pageObj = pdfPages.find(p => p.id === id);
            if (pageObj) {
                initiatePageDrag(e, pageObj);
            }
        });

        sidebarEl.appendChild(numIndicator);
        sidebarEl.appendChild(deleteBtn);
        sidebarEl.appendChild(dragHandle);

        // Assembling sidebar and page skeleton into wrapper
        wrapper.appendChild(pageEl);
        wrapper.appendChild(sidebarEl);

        pageObserver.observe(pageEl);
        container.appendChild(wrapper);

        // Extracting text data items immediately for this specific page's index
        const textContent = await pageProxy.getTextContent();
        const textIndex = textContent.items.map(item => ({
            str: item.str,
            transform: item.transform,
            width: item.width,
            height: item.height
        }));

        pdfPages.push({
            id: id,
            proxy: pageProxy,
            viewport: viewport,
            isLoaded: false,
            wrapper: wrapper,
            element: pageEl,
            sidebar: sidebarEl,
            textIndex: textIndex,
            redactions: []
        });
    }

    updatePageCount();
    jumpToPage(lastPageIndex);
}


// Jumping to page by index
function jumpToPage(index) {
    const targetPageObj = pdfPages[index];
    if (targetPageObj && targetPageObj.element) {
        const elementPosition = targetPageObj.element.offsetTop;
        const offsetPosition = elementPosition - HEADER_OFFEST;
        container.scrollTo({
            top: offsetPosition,
            behavior: 'auto'
        });
    }
}


// Loading a specific page by generating its canvas and text layer
async function loadPage(pageObj) {
    // Skipping loading already loaded pages
    if (pageObj.isLoaded) return;

    // 1. Setup Canvas
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    const context = canvas.getContext('2d');

    canvas.height = pageObj.viewport.height;
    canvas.width = pageObj.viewport.width;

    const renderContext = {
        canvasContext: context,
        viewport: pageObj.viewport
    };

    try {
        // Waiting for canvas to visually render
        await pageObj.proxy.render(renderContext).promise;

        // Setting up highlight Layer container
        const highlightLayerDiv = document.createElement('div');
        highlightLayerDiv.className = 'pdf-highlight-layer';
        highlightLayerDiv.style.width = `${pageObj.viewport.width}px`;
        highlightLayerDiv.style.height = `${pageObj.viewport.height}px`;

        // Setting up Redaction Layer container
        const redactionLayerDiv = document.createElement('div');
        redactionLayerDiv.className = 'pdf-redaction-layer';
        redactionLayerDiv.style.width = `${pageObj.viewport.width}px`;
        redactionLayerDiv.style.height = `${pageObj.viewport.height}px`;
        
        // Setting up Text Layer
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';

        // Matching the dimensions of the canvas
        textLayerDiv.style.width = `${pageObj.viewport.width}px`;
        textLayerDiv.style.height = `${pageObj.viewport.height}px`;
        textLayerDiv.style.setProperty('--scale-factor', pageObj.viewport.scale);

        // Fetching and Rendering Text
        const textContent = await pageObj.proxy.getTextContent();
        
        // Adding to DOM before rendering text
        pageObj.element.appendChild(canvas);
        pageObj.element.appendChild(highlightLayerDiv);
        pageObj.element.appendChild(redactionLayerDiv);
        pageObj.element.appendChild(textLayerDiv);

        await pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: pageObj.viewport,
            textDivs: []
        }).promise;

        // Finalizing state
        pageObj.element.classList.add('pdf-page-rendered');
        pageObj.isLoaded = true;

        applyHighlights(pageObj);
        applyRedactions(pageObj);
    } catch (error) {
        console.error('Error rendering page or text layer:', error);
    }
}


// Unloading a specific page
function unloadPage(pageObj) {
    // Can't unload pages that aren't loaded
    if (!pageObj.isLoaded) return;

    pageObj.element.innerHTML = '';
    pageObj.element.classList.remove('pdf-page-rendered');
    pageObj.isLoaded = false;
    //console.log('unloaded ' + pageObj.id);
}


// Highlighting all text matching the search query from the search index in a specified page
const metricMeasurer = document.createElement('canvas').getContext('2d');
function applyHighlights(pageObj) {
    const highlightLayerDiv = pageObj.element.querySelector('.pdf-highlight-layer');
    if (!highlightLayerDiv) return;

    // Resetting the highlight layer for this page
    highlightLayerDiv.innerHTML = '';

    if (!currentSearchQuery || !currentSearchQuery.trim()) return;

    const queryLower = currentSearchQuery.toLowerCase();
    const scale = pageObj.viewport.scale;

    pageObj.textIndex.forEach(item => {
        const strLower = item.str.toLowerCase();
        if (!strLower.includes(queryLower)) return;

        // Mapping base PDF coordinates into viewport space pixels
        const tx = pdfjsLib.Util.transform(pageObj.viewport.transform, item.transform);
        const totalWidth = item.width * scale;
        const height = item.height * scale;

        // Setting offscreen canvas font size to match the calculated height
        metricMeasurer.font = `${height}px sans-serif`;
        const canvasFullWidth = metricMeasurer.measureText(item.str).width;
        
        // Calculating the scaling ratio between the browser's font engine and the PDF's structural width
        const scalingRatio = canvasFullWidth > 0 ? (totalWidth / canvasFullWidth) : 1;

        let startIdx = 0;
        while ((startIdx = strLower.indexOf(queryLower, startIdx)) !== -1) {
            // Segmenting the string to measure character widths proportionally
            const textBeforeMatch = item.str.substring(0, startIdx);
            const targetMatchText = item.str.substring(startIdx, startIdx + queryLower.length);

            // Measuring unscaled browser text widths
            const unscaledLeftOffset = metricMeasurer.measureText(textBeforeMatch).width;
            const unscaledMatchWidth = metricMeasurer.measureText(targetMatchText).width;

            // Applying the PDF scale ratio to lock alignment
            const leftOffset = unscaledLeftOffset * scalingRatio;
            const matchWidth = unscaledMatchWidth * scalingRatio;

            const highlight = document.createElement('div');
            highlight.className = 'pdf-highlight-match';

            // Current match highlight
            if (
                allMatches[currentMatchIndex] &&
                allMatches[currentMatchIndex].pageObj.id === pageObj.id &&
                allMatches[currentMatchIndex].item === item &&
                allMatches[currentMatchIndex].startIdx === startIdx
            ) {
                highlight.classList.add('current-match');
            }
            
            highlight.style.left = `${tx[4] + leftOffset}px`;
            highlight.style.top = `${tx[5] - (height * 0.82)}px`;
            highlight.style.width = `${matchWidth}px`;
            highlight.style.height = `${height}px`;

            highlightLayerDiv.appendChild(highlight);

            startIdx += queryLower.length;
        }
    });
}

// Render all redactions for a page
function applyRedactions(pageObj) {
    const redactionLayer = pageObj.element.querySelector('.pdf-redaction-layer');
    if (!redactionLayer) return;

    // Clearing previous elements
    redactionLayer.innerHTML = '';

    // Creating redaction element for each redaction in page
    pageObj.redactions.forEach(item => {
        switch(item.type) {
            case 'rect':
                const box = document.createElement('div');
                box.className = 'pdf-redaction-box';
                box.style.position = 'absolute';
                box.style.left = `${item.x}px`;
                box.style.top = `${item.y}px`;
                box.style.width = `${item.width}px`;
                box.style.height = `${item.height}px`;
                box.style.backgroundColor = item.color;
                redactionLayer.appendChild(box);
                break;
            
            case 'paint':
                // Build SVG element wrapper
                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.classList.add('paint-svg');

                // Building the vector path geometry node
                const pathNode = document.createElementNS("http://www.w3.org/2000/svg", "path");
                pathNode.setAttribute("d", item.path);
                pathNode.setAttribute("stroke", item.color);
                pathNode.setAttribute("stroke-width", item.size);
                pathNode.setAttribute("fill", "none");
                pathNode.setAttribute("stroke-linecap", "round");
                pathNode.setAttribute("stroke-linejoin", "round");

                svg.appendChild(pathNode);
                redactionLayer.appendChild(svg);
                break;
            
            case 'text':
                const textBlock = document.createElement('div');
                textBlock.className = 'pdf-redaction-text';
                textBlock.style.position = 'absolute';
                textBlock.style.left = `${item.x}px`;
                textBlock.style.top = `${item.y}px`;
                textBlock.style.color = item.color;
                textBlock.style.fontSize = `${item.size}px`;
                textBlock.style.fontFamily = item.font || 'sans-serif';
                textBlock.textContent = item.text;
                redactionLayer.appendChild(textBlock);
                break;
            
            default:
                throw new Error("Unrecognized redaction type");
        }
    });
}


// Updating the matches to the search query to a list for iterating over matches
const totalNumEl = document.getElementById('total-matches-num');
const currentNumEl = document.getElementById('current-match-num');
const redactAllBtn = document.getElementById('redact-all-btn');
function updateMatchesList() {
    allMatches = [];
    if (!currentSearchQuery || !currentSearchQuery.trim()) {
        currentMatchIndex = -1;
        totalNumEl.textContent = '0';
        currentNumEl.textContent = '0';
        redactAllBtn.classList.add('disabled');
        return;
    }

    const queryLower = currentSearchQuery.toLowerCase();

    // Looping through document in order
    pdfPages.forEach(pageObj => {
        pageObj.textIndex.forEach(item => {
            const strLower = item.str.toLowerCase();
            let startIdx = 0;

            while ((startIdx = strLower.indexOf(queryLower, startIdx)) !== -1) {
                allMatches.push({
                    pageObj: pageObj,
                    item: item,
                    startIdx: startIdx
                });
                startIdx += queryLower.length;
            }
        });
    });

    // Updating Counter UI text tags
    totalNumEl.textContent = allMatches.length;
    
    if (allMatches.length > 0) {
        currentMatchIndex = 0;
        currentNumEl.textContent = '1';
        redactAllBtn.classList.remove('disabled');
    } else {
        currentMatchIndex = -1;
        currentNumEl.textContent = '0';
        redactAllBtn.classList.add('disabled');
    }
}


// Jumping to specific location of search match by its index in the matches list, by finding it's page and location on the page
async function jumpToMatch(index) {
    if (index < 0 || index >= allMatches.length) return;
    
    currentMatchIndex = index;
    const currentNumEl = document.getElementById('current-match-num');
    if (currentNumEl) currentNumEl.textContent = index + 1;

    const match = allMatches[index];

    // Awaiting page load if match is on unloaded page
    if (!match.pageObj.isLoaded) {
        await loadPage(match.pageObj);
    }

    // Refreshing highlights across loaded pages
    pdfPages.forEach(p => {
        if (p.isLoaded) applyHighlights(p);
    });

    // Viewport Alignment Calculation
    const container = document.getElementById('pdf-container');

    // Calculating the match's absolute position
    const scale = match.pageObj.viewport.scale;
    const tx = pdfjsLib.Util.transform(match.pageObj.viewport.transform, match.item.transform);
    const height = match.item.height * scale;
    const correctedTop = tx[5] - (height * 0.82);
    const matchAbsoluteTop = match.pageObj.wrapper.offsetTop + correctedTop;

    // Calculating center
    const containerHeight = container.clientHeight;
    const scrollToPos = matchAbsoluteTop - (containerHeight / 2) + (height / 2);

    // Jumping to match
    container.scrollTo({
        top: scrollToPos,
        behavior: 'auto'
    });
}


// Moving backwards or forwards through the search matches list
function navigateMatch(direction) {
    if (allMatches.length === 0) return;
    
    let newIndex = currentMatchIndex + direction;
    if (newIndex >= allMatches.length) newIndex = 0;
    if (newIndex < 0) newIndex = allMatches.length - 1;

    jumpToMatch(newIndex);
}


// Updating page total number, individual pages numbers
const pagesTotal = document.getElementById('pages-total');
function updatePageCount() {
    // Updating total pages
    pagesTotal.innerText = pdfPages.length;

    // Updating pages numbers
    for (let i = 0; i < pdfPages.length; i++) {
        pdfPages[i].sidebar.querySelector('.sidebar-page-num').innerText = (i + 1);
    }

    loadPagesInRange();
}


// Loading all pages in range from current page, and unloading the rest
function loadPagesInRange() {
    const total = pdfPages.length;
    const currentIndex = pageNum - 1;

    // Processing current page
    if (currentIndex >= 0 && currentIndex < total) {
        loadPage(pdfPages[currentIndex]);
    }

    // Expanding outwards
    for (let offset = 1; offset <= PAGE_LOAD_RANGE; offset++) {
        const next = currentIndex + offset;
        const prev = currentIndex - offset;

        if (next < total) loadPage(pdfPages[next]);
        if (prev >= 0) loadPage(pdfPages[prev]);
    }

    // Unloading the rest
    pdfPages.forEach((pageObj, idx) => {
        if (Math.abs((idx + 1) - pageNum) > PAGE_LOAD_RANGE) {
            unloadPage(pageObj);
        }
    });
}


// Initializing page drag by rendering a preview of the page and starting the auto-scroll loop
function initiatePageDrag(e, pageObj) {
    if (e.button !== 0) return;
    e.preventDefault();
    
    isDragging = true;
    draggedPageObj = pageObj;
    currentClientX = e.clientX;
    currentClientY = e.clientY;

    const originalCanvas = pageObj.element.querySelector('.pdf-page-canvas');
    const scaleFactor = 0.25;
    
    // Creating floating canvas clone element
    dragPreview = document.createElement('canvas');
    if (originalCanvas) {
        dragPreview.width = originalCanvas.width;
        dragPreview.height = originalCanvas.height;
        const ctx = dragPreview.getContext('2d');
        ctx.drawImage(originalCanvas, 0, 0);
    } else {
        // Fallback if the canvas hasn't fully rendered
        dragPreview.width = parseInt(pageObj.element.style.width) || 200;
        dragPreview.height = parseInt(pageObj.element.style.height) || 300;
        const ctx = dragPreview.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, dragPreview.width, dragPreview.height);
    }
    
    const previewWidth = dragPreview.width * scaleFactor;
    const previewHeight = dragPreview.height * scaleFactor;
    
    // Applying floating style
    dragPreview.classList.add('drag-preview');
    dragPreview.style.width = `${previewWidth}px`;
    dragPreview.style.height = `${previewHeight}px`;
    
    // Centering the preview thumbnail precisely over the cursor
    dragPreview.style.left = `${currentClientX - previewWidth / 2}px`;
    dragPreview.style.top = `${currentClientY - previewHeight / 2}px`;
    
    document.body.appendChild(dragPreview);
    
    // Kick off the auto-scrolling loop
    requestAnimationFrame(handleScrollLoop);
}

// Scroll animation loop for page dragging relative to screen center
function handleScrollLoop() {
    if (!isDragging) return;
    
    // Calculating the distance of the cursor from the center
    const screenCenterY = (window.innerHeight + HEADER_OFFEST) / 2;
    const distanceToCenter = currentClientY - screenCenterY;
    const deadzone = 50;
    
    if (Math.abs(distanceToCenter) > deadzone) {
        // Calculate the relative distance outside the deadzone
        const scrollDirection = distanceToCenter > 0 ? 1 : -1;
        const intensity = (Math.abs(distanceToCenter) - deadzone);
        
        container.scrollTop += (scrollDirection * intensity * 0.1);
    }
    
    requestAnimationFrame(handleScrollLoop);
}


// Function for updates when changing between document loaded state
const pageInput = document.getElementById('page-num-input');
const zoomInput = document.getElementById('zoom-input');
function changeStateLoaded(isLoaded) {
    if (isLoaded === loadedState) {
        return;
    } else {
        loadedState = isLoaded;
    }

    if (isLoaded) {
        // Hiding drop zone and showing pages container
        document.getElementById('drop-zone').classList.add('hidden');
        container.classList.remove('hidden');

        // Enabling things in header
        document.getElementById('clear-btn').classList.remove('disabled');
        document.getElementById('export-btn').classList.remove('disabled');
        document.getElementById('page-num-input').classList.remove('disabled');
        document.getElementById('search-section').classList.remove('disabled');
        document.getElementById('editing-section').classList.remove('disabled');

        pageInput.value = 1;
        pageNum = 1;
    } else {
        // Showing drop zone and hiding pages container
        document.getElementById('drop-zone').classList.remove('hidden');
        container.classList.add('hidden');

        // Clearing document
        container.innerHTML = '';
        pdfPages = [];
        undoStack = [];
        originalPdfBytes = null;

        // Disabling things in header
        document.getElementById('clear-btn').classList.add('disabled');
        document.getElementById('export-btn').classList.add('disabled');
        document.getElementById('page-num-input').classList.add('disabled');
        document.getElementById('search-section').classList.add('disabled');
        document.getElementById('editing-section').classList.add('disabled');

        // Page numbers reset
        pageNum = 0;
        pageInput.value = 0;
        document.getElementById('page-num-input').value = 0;
        updatePageCount();

        // Searches reset
        document.getElementById('search-bar').value = '';
        currentSearchQuery = '';
        updateMatchesList();

        // Zoom reset
        zoomInput.value = '100%';
        currentZoom = 1.0;

        // Disabling selected tool
        swapTool();
    }
}


// Scaling entire document and recalculate layout structures
function changeZoom(newZoom) {
    if (!loadedState || newZoom === currentZoom) return;

    const oldZoom = currentZoom;
    currentZoom = newZoom;
    const scaleRatio = currentZoom / oldZoom;

    // Capturing current scroll location before modifying elements
    const oldScrollTop = container.scrollTop;

    pdfPages.forEach(pageObj => {
        // Getting new PDF.js viewport bounding matrix
        pageObj.viewport = pageObj.proxy.getViewport({ scale: currentZoom });

        // Resizing base DOM skeleton structures
        pageObj.element.style.width = `${pageObj.viewport.width}px`;
        pageObj.element.style.height = `${pageObj.viewport.height}px`;
        pageObj.sidebar.style.height = `${pageObj.viewport.height}px`;

        // Scaling existing redactions vector configurations proportionally
        pageObj.redactions.forEach(item => {
            if (item.x !== undefined) item.x *= scaleRatio;
            if (item.y !== undefined) item.y *= scaleRatio;
            if (item.width !== undefined) item.width *= scaleRatio;
            if (item.height !== undefined) item.height *= scaleRatio;
            if (item.size !== undefined) item.size *= scaleRatio;
            
            // Scaler helper regex for brush stroke strings
            if (item.path) {
                item.path = item.path.replace(/[-+]?\d*\.?\d+/g, (match) => {
                    return (parseFloat(match) * scaleRatio).toFixed(1);
                });
            }
        });

        // Forcing unload currently loaded layers so they re-render fresh at new resolution
        unloadPage(pageObj);
    });

    // Anchoring user's viewport perspective where they were looking
    container.scrollTop = oldScrollTop * scaleRatio;
    loadPagesInRange();
}


// Language toggle button
document.getElementById('lang-btn').addEventListener('click', () => applyLanguage());

// Selecting file from add file button
document.getElementById('add-btn').addEventListener('click', () => {
    fileInput.click();
});


// Loading selected PDF
const fileInput = document.getElementById('pdf-upload');
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    
    if (file && file.type === 'application/pdf') {   
        await loadPDF(file);
        fileInput.value = '';
    } else {
        alert('Please select a valid PDF file.');
    }
});

// Preventing default browser drop behavior
const dropZone = document.getElementById('drop-zone');
['dragover', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
});

// Loading file from drop zone
dropZone.addEventListener('drop', async (e) => {
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
        await loadPDF(file);
    }
});

// Selecting file from clicking drop zone
dropZone.addEventListener('click', () => {
    fileInput.click();
});

// Writable inputs with default options
document.querySelectorAll('input[list]').forEach(input => {
    // Storing value and clearing it when clicking
    input.addEventListener('mousedown', function() {
        this._oldValue = this.value; 
        this.value = '';
    });

    // Restoring the value if they clicked away
    input.addEventListener('blur', function() {
        if (this.value === '' && this._oldValue !== undefined) {
            this.value = this._oldValue;
        }
    });

    // Clearing stored value something was chosen
    input.addEventListener('change', function() {
        this._oldValue = this.value;
    });
});

// Clear all button
document.getElementById('clear-btn').addEventListener('click', () => {
    if (confirm(translations[lang]['clearAllWarn'])) {
        changeStateLoaded(false);
    }
});

// Page number input
pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        // Getting page number and clamping it to valid range
        let pageNum = parseInt(pageInput.value);
        if (isNaN(pageNum) || pageNum < 1) pageNum = 1;
        else if (pageNum > pdfPages.length) pageNum = pdfPages.length;

        pageInput.value = pageNum;
        jumpToPage(pageNum - 1);
    }
});
pageInput.addEventListener('blur', () => {
    pageInput.value = pageNum;
});

// Search bar change
document.getElementById('search-bar').addEventListener('input', (e) => {
    currentSearchQuery = e.target.value;

    // Rebuilding flat list metrics and counters
    updateMatchesList();
    
    // Dynamically updating all active, rendered highlight layers across the DOM
    pdfPages.forEach(pageObj => {
        if (pageObj.isLoaded) {
            applyHighlights(pageObj);
        }
    });

    if (allMatches.length > 0) {
        jumpToMatch(0);
    }
});

// Next/Prev Buttons Integration
document.getElementById('search-next-btn').addEventListener('click', () => navigateMatch(1));
document.getElementById('search-prev-btn').addEventListener('click', () => navigateMatch(-1));

// Arrow Key Navigation Router
document.addEventListener('keydown', (e) => {
    if (allMatches.length === 0) return;

    // Typing protection
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        navigateMatch(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        navigateMatch(-1);
    }
});

// Updating page drag preview to mouse position
window.addEventListener('mousemove', (e) => {
    if (!isDragging || !dragPreview) return;
    
    currentClientX = e.clientX;
    currentClientY = e.clientY;
    
    const previewWidth = parseFloat(dragPreview.style.width);
    const previewHeight = parseFloat(dragPreview.style.height);
    
    dragPreview.style.left = `${currentClientX - previewWidth / 2}px`;
    dragPreview.style.top = `${currentClientY - previewHeight / 2}px`;
});

// Page drag release logic, finding dropped page index and moving page object and element
window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    
    if (dragPreview) {
        dragPreview.remove();
        dragPreview = null;
    }
    
    // Finding target page
    let targetPageObj = null;
    const searchRange = [pageNum-2, pageNum-1, pageNum];
    
    for (let i of searchRange) {
        if (i >= 0 && i < pdfPages.length) {
            const rect = pdfPages[i].wrapper.getBoundingClientRect();
            // Checking if cursor is within this page's vertical bounds
            if (currentClientY >= rect.top && currentClientY <= rect.bottom) {
                targetPageObj = pdfPages[i];
                break;
            }
        }
    }
    
    if (targetPageObj && targetPageObj !== draggedPageObj) {
        // Capturing scroll coordinate right before manipulation pass
        const savedScrollTop = container.scrollTop;
        
        const oldIndex = pdfPages.indexOf(draggedPageObj);
        const newIndex = pdfPages.indexOf(targetPageObj);
        
        if (oldIndex !== newIndex) {
            executeAction(new MovePageAction(oldIndex, newIndex));
            
            // Scrolling back to previous position
            requestAnimationFrame(() => {
                container.scrollTop = savedScrollTop;
            });
        }
    }
    
    draggedPageObj = null;
});

// Tool buttons
document.getElementById('tool-rect-btn').addEventListener('click', () => swapTool('rect'));
document.getElementById('tool-paint-btn').addEventListener('click', () => swapTool('paint'));
document.getElementById('tool-text-btn').addEventListener('click', () => swapTool('text'));

// Tool key listeners


// Switching selected tool
const brushCursor = document.getElementById('brush-cursor-preview');
function swapTool(tool) {
    if (!loadedState) return;

    // Removing previous active tool
    const curActive = document.querySelector('.active');
    if (curActive) curActive.classList.remove('active');

    // Removing tool based cursors
    container.classList.remove('tool-active', 'tool-active-rect', 'tool-active-paint', 'tool-active-text');
    brushCursor.style.display = 'none';

    if (tool && tool !== activeTool) {
        // Selecting new tool
        activeTool = tool;
        document.getElementById(`tool-${tool}-btn`).classList.add('active');
        container.classList.add('tool-active');
        container.classList.add(`tool-active-${tool}`);
        if (activeTool === 'paint') updateBrushCursorSize();
    } else {
        // Disabling tool if it was already selected
        activeTool = null;
    }
}

// Font select change
document.getElementById('font-selector').addEventListener('change', (e) => {
    const selectedValue = e.target.value;
    activeFont = selectedValue;
    updateActiveTextboxStyles()
});

// Function for updating tool size
function updateToolSize(value) {
    toolSize = Math.min(Math.max(1, value), 150);
    sizeInput.value = toolSize;
    updateActiveTextboxStyles()
    if (activeTool === 'paint') updateBrushCursorSize();
}

function updateBrushCursorSize() {
    brushCursor.style.width = `${toolSize}px`;
    brushCursor.style.height = `${toolSize}px`;
}

// Size input select
const sizeInput = document.getElementById('size-input');
sizeInput.addEventListener('input', (e) => {
    updateToolSize(e.target.value);
});
// Safety fallback
sizeInput.addEventListener('blur', (e) => {
    if (e.target.value === '' || parseInt(e.target.value, 10) <= 0) {
        sizeInput.value = toolSize;
    }
});

// Size arrow buttons
document.getElementById('size-up-btn').addEventListener('click', () => {
    updateToolSize(toolSize + 1);
});
document.getElementById('size-down-btn').addEventListener('click', () => {
    updateToolSize(toolSize - 1);
});

// Color picker
const colorBtn = document.getElementById('color-btn');
document.getElementById('color-picker').addEventListener('input', (e) => {
    const selectedColor = e.target.value;
    activeColor = selectedColor;
    colorBtn.style.backgroundColor = selectedColor;
    updateActiveTextboxStyles()
});

// Undo action
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        if (undoStack.length === 0) return;
        e.preventDefault();

        // If there's an active textbox, removing it instead of undoing action from stack
        if (activeTextboxEl && document.activeElement === activeTextboxEl) {
            isCancelingText = true;
            activeTextboxEl.blur();
            isCancelingText = false;
            return;
        }

        // Removing action from stack
        const actionToUndo = undoStack.pop();
        const targetIndex = actionToUndo.undo();

        // Jumping to undo location
        if (targetIndex + 1 !== pageNum) {
            if (targetIndex >= pdfPages.length) {
                // Fallback if target index is out of range
                container.scrollTop = container.scrollHeight;
            } else {
                const targetedPage = pdfPages[targetIndex];
                if (targetedPage && targetedPage.wrapper) {
                    container.scrollTop = targetedPage.wrapper.offsetTop - container.offsetTop;
                }
            }
        }

        if (undoStack.length === 0) changeStateLoaded(false);
        //console.log(undoStack);
    }
});

// Custom paint brush cursor update
window.addEventListener('mousemove', (e) => {
    if (activeTool !== 'paint') return;

    brushCursor.style.left = `${e.clientX}px`;
    brushCursor.style.top = `${e.clientY}px`;
    
    if (e.target.closest('.pdf-page-skeleton')) {
        brushCursor.style.display = 'block';
    } else {
        brushCursor.style.display = 'none';
    }
});

// Redaction drawing click start
container.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !activeTool) return;

    const pageEl = e.target.closest('.pdf-page-skeleton');
    if (!pageEl) return;

    const pageObj = pdfPages.find(p => p.id === pageEl.id);
    if (!pageObj) return;

    drawingPageObj = pageObj;
    const rect = pageEl.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    switch(activeTool) {
        case 'rect':
            isDrawingRect = true;

            rectStartX = localX;
            rectStartY = localY;

            // Building drawing action preview wrapper box element
            rectPreviewEl = document.createElement('div');
            rectPreviewEl.className = 'pdf-rect-preview';
            rectPreviewEl.style.left = `${rectStartX}px`;
            rectPreviewEl.style.top = `${rectStartY}px`;
            rectPreviewEl.style.backgroundColor = activeColor;

            pageEl.appendChild(rectPreviewEl);
            break;
        
        case 'paint':
            isPainting = true;

            // Initializing SVG coordinate string
            currentPaintPath = `M ${localX.toFixed(1)} ${localY.toFixed(1)}`;

            // Building temporary preview stroke
            paintPreviewSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            paintPreviewSvg.classList.add('paint-svg-preview');

            paintPreviewPathNode = document.createElementNS("http://www.w3.org/2000/svg", "path");
            paintPreviewPathNode.setAttribute("d", currentPaintPath);
            paintPreviewPathNode.setAttribute("stroke", activeColor);
            paintPreviewPathNode.setAttribute("stroke-width", toolSize);
            paintPreviewPathNode.setAttribute("fill", "none");
            paintPreviewPathNode.setAttribute("stroke-linecap", "round");
            paintPreviewPathNode.setAttribute("stroke-linejoin", "round");

            paintPreviewSvg.appendChild(paintPreviewPathNode);
            pageEl.appendChild(paintPreviewSvg);
            break;
        
        case 'text':
            if (activeTextboxEl) {
                // Do nothing if clicked inside box
                if (e.target === activeTextboxEl) return;

                // If clicking outside, check if empty
                if (activeTextboxEl.value.trim() === '') {
                    activeTextboxEl = null;
                } else {
                    activeTextboxEl.blur();
                    return;
                }
            }

            textStartX = localX;
            textStartY = localY;
            activeTextPageObj = pageObj;
            break;
    }
});

// Redaction drawing drag preview
window.addEventListener('mousemove', (e) => {
    if (!drawingPageObj) return;

    const rect = drawingPageObj.element.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    if (isDrawingRect && rectPreviewEl) {
        // Calculating rect dimensions
        const x = Math.min(rectStartX, currentX);
        const y = Math.min(rectStartY, currentY);
        const width = Math.abs(rectStartX - currentX);
        const height = Math.abs(rectStartY - currentY);

        rectPreviewEl.style.left = `${x}px`;
        rectPreviewEl.style.top = `${y}px`;
        rectPreviewEl.style.width = `${width}px`;
        rectPreviewEl.style.height = `${height}px`;
    } 
    else if (isPainting && paintPreviewPathNode) {
        // Adding paint path coordinate
        currentPaintPath += ` L ${currentX.toFixed(1)} ${currentY.toFixed(1)}`;
        paintPreviewPathNode.setAttribute("d", currentPaintPath);
    }
});

// Rect drawing click release
window.addEventListener('mouseup', (e) => {
    if (!drawingPageObj) return;

    switch(activeTool) {
        case 'rect':
            if (!isDrawingRect) return;
            isDrawingRect = false;

            // Calculating final rect dimensions
            const rect = drawingPageObj.element.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;

            const x = Math.min(rectStartX, currentX);
            const y = Math.min(rectStartY, currentY);
            const width = Math.abs(rectStartX - currentX);
            const height = Math.abs(rectStartY - currentY);

            // Removing preview rect
            if (rectPreviewEl) {
                rectPreviewEl.remove();
                rectPreviewEl = null;
            }

            // Safety threshold to ignore tiny clicks
            if (width > 3 && height > 3) {
                const rectData = {
                    id: `rect-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    type: 'rect',
                    x: x,
                    y: y,
                    width: width,
                    height: height,
                    color: activeColor
                };
                executeAction(new RedactionAction(drawingPageObj.id, rectData));
            }
            break;

        case 'paint':
            if (!isPainting) return;
            isPainting = false;

            // Removing preview paint stroke
            if (paintPreviewSvg) {
                paintPreviewSvg.remove();
                paintPreviewSvg = null;
                paintPreviewPathNode = null;
            }

            const data = {
                id: `text-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: 'paint',
                path: currentPaintPath,
                color: activeColor,
                size: toolSize
            };
            executeAction(new RedactionAction(drawingPageObj.id, data));
            break;
        
        case 'text':
            if (!activeTextPageObj) return;
            const pageEl = e.target.closest('.pdf-page-skeleton');
            
            // Ensuring mouse release happens over the same page boundary
            if (pageEl && activeTextPageObj && pageEl.id === activeTextPageObj.id) {
                // Saving initial positon
                const startX = textStartX;
                const startY = textStartY;

                const textarea = document.createElement('textarea');
                textarea.className = 'pdf-text-textarea';
                textarea.style.left = `${startX}px`;
                textarea.style.top = `${startY}px`;
                
                // Syncing initial active layout properties
                textarea.style.color = activeColor;
                textarea.style.fontSize = `${toolSize}px`;
                textarea.style.fontFamily = activeFont || 'sans-serif';
                textarea.rows = 1;

                // Textarea auto-growing
                textarea.addEventListener('input', () => {
                    textarea.style.width = 'auto';
                    textarea.style.width = `${Math.max(120, textarea.scrollWidth)}px`;
                    textarea.style.height = 'auto';
                    textarea.style.height = `${textarea.scrollHeight}px`;
                });

                // Committing the final string block on blur
                const targetPageId = activeTextPageObj.id;
                textarea.addEventListener('blur', (e) => {
                    // If textbox was canceled with undo
                    if (isCancelingText) {
                        if (textarea.parentNode) textarea.remove();
                        activeTextboxEl = null;
                        return;
                    }
                    if (!textarea || !textarea.parentNode) return;

                    // Checking if the thing the user clicked is inside the header toolbar controls
                    const relatedTarget = e.relatedTarget || document.activeElement;
                    if (relatedTarget && relatedTarget.closest('.main-header')) {
                        // If click is a writable input element
                        if (relatedTarget.tagName === 'INPUT' && (relatedTarget.type === 'number' || relatedTarget.type === 'text')) {
                            // Waiting for writing to finish
                            const returnFocusHandler = () => {
                                // Returning focus if textbox element is still active
                                if (document.body.contains(textarea)) {
                                    textarea.focus();
                                }
                                relatedTarget.removeEventListener('change', returnFocusHandler);
                                relatedTarget.removeEventListener('blur', returnFocusHandler);
                            };

                            relatedTarget.addEventListener('change', returnFocusHandler);
                            relatedTarget.addEventListener('blur', returnFocusHandler);
                            return; // Exit here, leaving the textarea open and active!
                        } else {
                            // Refocusing immediately For the rest
                            textarea.focus();
                            return;
                        }
                    }

                    const finishedText = textarea.value.trim();
                    if (finishedText.length > 0) {
                        const data = {
                            id: `text-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            type: 'text',
                            x: startX,
                            y: startY,
                            text: textarea.value,
                            color: activeColor,
                            size: toolSize,
                            font: activeFont
                        };
                        executeAction(new RedactionAction(targetPageId, data));
                    }
                    textarea.remove();
                    setTimeout(() => {activeTextboxEl = null;}, 50);
                });

                pageEl.appendChild(textarea);
                activeTextboxEl = textarea;

                // Forcing DOM to focus on textarea
                setTimeout(() => {
                    textarea.focus();
                    textarea.style.width = '120px';
                    textarea.style.height = `${textarea.scrollHeight}px`;
                }, 0);
            }
            activeTextPageObj = null;
            break;
    }

    drawingPageObj = null;
});

// Style syncing helper function for updating active textbox visuals
function updateActiveTextboxStyles() {
    if (activeTextboxEl) {
        activeTextboxEl.style.color = activeColor;
        activeTextboxEl.style.fontSize = `${toolSize}px`;
        activeTextboxEl.style.fontFamily = activeFont || 'sans-serif';
        activeTextboxEl.style.width = 'auto';
        activeTextboxEl.style.width = `${Math.max(120, activeTextboxEl.scrollWidth)}px`;
        activeTextboxEl.style.height = 'auto';
        activeTextboxEl.style.height = `${activeTextboxEl.scrollHeight}px`;
    }
}

redactAllBtn.addEventListener('click', () => {
    if (!currentSearchQuery || !currentSearchQuery.trim() || allMatches.length === 0 || !(confirm(translations[lang]['redactAllWarning']))) return;

    const padding = 5;
    const queryLength = currentSearchQuery.length;

    const dataList = allMatches.map(match => {
        const pageObj = match.pageObj;
        const item = match.item;
        const startIdx = match.startIdx;
        const scale = pageObj.viewport.scale;

        // Calculating match bounds
        const tx = pdfjsLib.Util.transform(pageObj.viewport.transform, item.transform);
        const totalWidth = item.width * scale;
        const height = item.height * scale;

        metricMeasurer.font = `${height}px sans-serif`;
        const canvasFullWidth = metricMeasurer.measureText(item.str).width;
        const scalingRatio = canvasFullWidth > 0 ? (totalWidth / canvasFullWidth) : 1;

        const textBeforeMatch = item.str.substring(0, startIdx);
        const targetMatchText = item.str.substring(startIdx, startIdx + queryLength);

        const unscaledLeftOffset = metricMeasurer.measureText(textBeforeMatch).width;
        const unscaledMatchWidth = metricMeasurer.measureText(targetMatchText).width;

        const leftOffset = unscaledLeftOffset * scalingRatio;
        const matchWidth = unscaledMatchWidth * scalingRatio;

        const highlightLeft = tx[4] + leftOffset;
        const highlightTop = tx[5] - (height * 0.82);

        // Padding boundaries to ensure coverage
        const paddedX = highlightLeft - padding;
        const paddedY = highlightTop - padding;
        const paddedWidth = matchWidth + (padding * 2);
        const paddedHeight = height + (padding * 2);

        // Constructing redaction rectangle data
        return {
            id: `rect-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'rect',
            x: Math.max(0, paddedX),
            y: Math.max(0, paddedY),
            width: paddedWidth,
            height: paddedHeight,
            color: activeColor,
            pageId: pageObj.id
        };
    });

    executeAction(new RedactAllAction(dataList));
});

// Zoom Selector Element Listener Handler
zoomInput.addEventListener('change', () => {
    // Stripping trailing percentages and parsing numeric entries
    let val = zoomInput.value.replace('%', '').trim();
    let zoomPercent = parseFloat(val);

    // Clamping values
    if (!isNaN(zoomPercent) && zoomPercent >= 25 && zoomPercent <= 500) {
        const newZoom = zoomPercent / 100;
        changeZoom(newZoom);
        zoomInput.value = `${zoomPercent}%`;
    } else {
        // Reverting back if invalid entry string provided
        zoomInput.value = `${Math.round(currentZoom * 100)}%`;
    }
});
zoomInput.addEventListener('blur', () => {
    let val = zoomInput.value.replace('%', '').trim();
    if (isNaN(parseFloat(val))) {
        zoomInput.value = `${Math.round(currentZoom * 100)}%`;
    }
});

// keyboard shortcut action listener
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        switch(e.code) {
            // Add file: ctrl + O
            case 'KeyO':
                e.preventDefault();
                fileInput.click();
                break;
            
            // Clear all: ctrl + del
            case 'Delete':
                if (!document.getElementById('clear-btn').classList.contains('disabled') && confirm(translations[lang]['clearAllWarn'])) changeStateLoaded(false);
                break;
            
            // Export: ctrl + E
            case 'KeyE':
                e.preventDefault();
                exportPDF();
                break;
            
            // Rectangle tool: ctrl + alt + R
            case 'KeyR':
                if (e.altKey) swapTool('rect');
                break;
            
            // Brush tool: ctrl + alt + B
            case 'KeyB':
                if (e.altKey) swapTool('paint');
                break;
            
            // Text tool: ctrl + alt + T
            case 'KeyT':
                if (e.altKey) swapTool('text');
                break;
        }
    }
});

const exportBtn = document.getElementById('export-btn');
exportBtn.addEventListener('click', exportPDF);

// Secure PDF Export Pipeline
async function exportPDF() {
    if (isExporting || !loadedState || pdfPages.length === 0) return;

    const originalText = exportBtn.innerText;
    isExporting = true;
    
    // Toggling processing state UI
    exportBtn.innerText = translations[lang]['exporting'];
    exportBtn.classList.add('disabled');

    try {
        // Dynamically injecting pdf-lib if missing
        if (typeof PDFLib === 'undefined') {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        const { PDFDocument } = PDFLib;
        const finalPdfDoc = await PDFDocument.create();
        
        let srcDoc = null;
        if (originalPdfBytes) {
            srcDoc = await PDFDocument.load(originalPdfBytes);
        }

        // Iterating over live app pages array
        for (const pageObj of pdfPages) {
            const hasRedactions = pageObj.redactions && pageObj.redactions.length > 0;

            if (!hasRedactions && srcDoc) {
                // If a page has no redactions, we use the original page content
                const origIndex = pageObj.proxy.pageNumber - 1;
                const [copiedPage] = await finalPdfDoc.copyPages(srcDoc, [origIndex]);
                finalPdfDoc.addPage(copiedPage);
            } else {
                // Flattening pages containing redactions
                const exportScale = 2.0; // Rendering at 2x resolution to maintain print sharpness
                const viewport = pageObj.proxy.getViewport({ scale: exportScale });
                
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext('2d');

                // Rendering only the original PDF background layer to offscreen canvas
                await pageObj.proxy.render({
                    canvasContext: ctx,
                    viewport: viewport
                }).promise;

                // Establishing canvas scale ratio against the editor canvas wrapper sizing bounds
                const scaleFactor = viewport.width / pageObj.viewport.width;
                
                ctx.save();
                ctx.scale(scaleFactor, scaleFactor);

                // Rendering matching modifications
                pageObj.redactions.forEach(item => {
                    ctx.save();
                    if (item.type === 'rect') {
                        ctx.fillStyle = item.color;
                        ctx.fillRect(item.x, item.y, item.width, item.height);
                    } 
                    else if (item.type === 'paint') {
                        ctx.strokeStyle = item.color;
                        ctx.lineWidth = item.size;
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                        ctx.stroke(new Path2D(item.path));
                    } 
                    else if (item.type === 'text') {
                        ctx.fillStyle = item.color;
                        ctx.font = `${item.size}px "${item.font || 'sans-serif'}"`;
                        ctx.textBaseline = 'top';
                        
                        // Handling multiline formatting clean arrays breakdown
                        const lines = item.text.split('\n');
                        lines.forEach((line, index) => {
                            ctx.fillText(line, item.x, item.y + (index * item.size * 1.2));
                        });
                    }
                    ctx.restore();
                });
                ctx.restore();

                // Encoding canvas down to structural binary image data array
                const imgDataUrl = canvas.toDataURL('image/jpeg', 0.94);
                const imgBytes = await fetch(imgDataUrl).then(res => res.arrayBuffer());
                const embeddedImg = await finalPdfDoc.embedJpg(imgBytes);
                
                // Creating blank document canvas shell page
                const baseViewport = pageObj.proxy.getViewport({ scale: 1.0 });
                const newPage = finalPdfDoc.addPage([baseViewport.width, baseViewport.height]);
                
                // Overlaying image snapshot across page
                newPage.drawImage(embeddedImg, {
                    x: 0,
                    y: 0,
                    width: baseViewport.width,
                    height: baseViewport.height
                });
            }
        }

        // Completing asset packaging compilation download trigger
        const pdfBytes = await finalPdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        const baseName = originalFileName.replace(/\.pdf$/i, "");
        a.download = `redacted_${baseName}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    } catch (err) {
        console.error('PDF Export engine failure pipeline interruption:', err);
        alert(translations[lang]['exportErr']);
    } finally {
        exportBtn.innerText = originalText;
        exportBtn.classList.remove('disabled');
        isExporting = false;
    }
}