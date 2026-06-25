pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const PAGE_LOAD_RANGE = 5;
const HEADER_OFFEST = 118;
const MAX_UNDO_STACK_SIZE = 40;

// General pdf
let loadedState = false;
let pdfPages = [];
let pageNum = 0;
let currentZoom = parseFloat(localStorage.getItem('pdf_zoom')) || 1.0;
let originalPdfBytes = null;
let isExporting = false;
let originalFileName = 'document.pdf';
let loadTimeout = null;
let currentLoadSequenceId = 0;
let currentBackgroundIndexId = 0;
let exportPreviewIndex = 0;

// Search
let currentSearchQuery = '';
let allMatches = [];
let currentMatchIndex = -1;
let skipFirstLetter = false;

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
let localFontsLoaded = false;

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

// Undo & redo stack
const container = document.getElementById('pdf-container');
let undoStack = [];
let redoStack = [];
const AppManager = {
    getPages: () => pdfPages,
    getContainer: () => container,
    refreshUI: () => {
        updatePageCount();
        updateMatchesList();
        loadPagesInRange();
    }
};
function executeAction(actionInstance, newAction) {
    // Adding action to undo stack
    undoStack.push(actionInstance);

    const targetIndex = actionInstance.execute();

    if (newAction) {
        // If a new action (not a redo) was executed, clearing redo list
        redoStack = [];

        // Capping undo stack size
        if (undoStack.length > MAX_UNDO_STACK_SIZE) {
            const evictedAction = undoStack.shift();

            if (evictedAction && evictedAction.deletedPageObj) {
                evictedAction.deletedPageObj = null; 
            }
        }
    } else {
        // Jumping to page of re-done action if not already on that page
        if (targetIndex + 1 !== pageNum) jumpToPage(targetIndex);
    }
    //console.log(undoStack, redoStack);
}


// Populating fonts selector
const fontOptionsContainer = document.getElementById('font-options');
populateFonts();
fontOptionsContainer.addEventListener('mousedown', async (e) => {
    // If already attempted loading local fonts, don't trigger the prompt again
    if (localFontsLoaded) return;
    
    // Checking if the browser even supports the local fonts API
    if ('queryLocalFonts' in window) {
        try {
            // Making request for user's font list
            const localFonts = await window.queryLocalFonts();
            
            if (localFonts && localFonts.length > 0) {
                // Extracting unique family names from the local system fonts descriptor array
                const uniqueNames = [...new Set(localFonts.map(f => f.family))].sort();
                
                // Merging fontList with the new system fonts, removing duplicates
                fontList = [...new Set([...fontList, ...uniqueNames])];

                // Re-rendering font list with new fonts
                populateFonts();
            }
        } catch (err) {
            console.warn("Local font permission denied or aborted:", err);
        } finally {
            localFontsLoaded = true;
        }
    } else {
        console.log("Local Font Access API is not supported in this browser.");
        localFontsLoaded = true;
    }
});

function populateFonts() {
    fontOptionsContainer.innerHTML = '';
    fontList.sort();
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
        helpTip: 'Help',
        helpLink: 'https://github.com/LeeBenShmaryahu/PDF-Redactor/blob/main/README.md',
        pages: 'pages',
        pagesOf: 'of',
        redactCurrentTip: 'Redact current match',
        redactFromTip: 'Redact all matches from here',
        skipFirstTip: 'Skip redacting first letter?',
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
        logoTwo: 'Developed by Lee Ben Shmaryahu',
        exportSettings: 'Export Settings',
        exportRes: {
            title: 'Export Resolution Scale',
            1: '1x (Standard)',
            1.5: '1.5x (Enhanced)',
            2: '2x (High Quality)',
            3: '3x (Print Quality)',
            desc: 'Higher scales produce sharper text and redactions but increase the final file size.'
        },
        exportNums: {
            title: 'Add Page Numbers',
            desc: 'Automatically stamp page numbers on the exported PDF pages.',
            posTitle: 'Number Position',
            topleft: 'Top Left',
            topcenter: 'Top Center',
            topright: 'Top Right',
            bottomleft: 'Bottom Left',
            bottomcenter: 'Bottom Center',
            bottomright: 'Bottom Right'
        },
        exportPage: 'Page',
        exportDoc: 'Export Document'
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
        helpTip: 'עזרה',
        helpLink: 'https://github.com/LeeBenShmaryahu/PDF-Redactor/blob/main/READMEHEBREW.md',
        pages: 'דפים',
        pagesOf: 'מתוך',
        redactCurrentTip: 'השחר התאמה זאת',
        redactFromTip: 'השחר כל התאמות מפה',
        skipFirstTip: 'דלג השחרת אות ראשונה?',
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
        logoTwo: 'פותח ע"י לי בן שמריהו',
        exportSettings: 'הגדרות הצאה',
        exportRes: {
            title: 'גודל רזולוציית הצאה',
            1: '1x (רגיל)',
            1.5: '1.5x (מוגבר)',
            2: '2x (איכות גבוהה)',
            3: '3x (איכות הדפסה)',
            desc: 'רזולוציות גדולות יותר יוצרות טקסט והשחרות ברורות יותר אך מעלות את גודל הקובץ.'
        },
        exportNums: {
            title: 'הוסף מספור דפים',
            desc: 'מוסיףבאופן אוטומטי מספור לדפים בקובץ המיוצא.',
            posTitle: 'מיקום מספר',
            topleft: 'שמאל למעלה',
            topcenter: 'מרכז למעלה',
            topright: 'ימין למעלה',
            bottomleft: 'שמאל למטה',
            bottomcenter: 'מרכז למטה',
            bottomright: 'ימין למטה'
        },
        exportPage: 'דף',
        exportDoc: 'יצא מסמך'
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
    document.getElementById('help-btn').dataset.tooltip = t.helpTip;
    document.getElementById('help-btn').href = t.helpLink;
    document.getElementById('pages-total-text').innerText = t.pages;
    document.getElementById('pages-total-text-of').innerText = t.pagesOf;
    document.getElementById('redact-current-btn').dataset.tooltip = t.redactCurrentTip;
    document.getElementById('redact-from-btn').dataset.tooltip = t.redactFromTip;
    document.getElementById('skip-first-btn').dataset.tooltip = t.skipFirstTip;
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
    document.getElementById('export-title-lbl').innerText = t.exportSettings;
    document.getElementById('export-scale-lbl').innerText = t.exportRes.title;
    for (let opt of document.getElementById('export-scale-select').children) {opt.innerText = t.exportRes[opt.value]};
    document.getElementById('export-scale-help').innerText = t.exportRes.desc;
    document.getElementById('export-numbers-lbl').innerText = t.exportNums.title;
    document.getElementById('export-numbers-help').innerText = t.exportNums.desc;
    document.getElementById('export-position-lbl').innerText = t.exportNums.posTitle;
    for (let opt of document.getElementById('export-position-select').children) {opt.innerText = t.exportNums[opt.value.replace('-', '')]};
    document.getElementById('preview-current-lbl').innerText = t.exportPage;
    document.getElementById('final-export-btn').innerText = t.exportDoc;
}


// Detecting when a new page is observed
const PAGE_NUM_INPUT = document.getElementById('page-num-input');
const observerOptions = {
    root: document.getElementById('pdf-container'),
    threshold: 0.5
};
let loadAnimationFrame = null;
const pageObserver = new IntersectionObserver((entries) => {
    let lastIntersectingIndex = -1;

    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const pageIndex = pdfPages.findIndex(p => p.id === entry.target.id);
            if (pageIndex !== -1) {
                // Tracking the most recent visible page index in this observation cycle
                lastIntersectingIndex = pageIndex;
            }
        }
    });

    if (lastIntersectingIndex !== -1) {
        pageNum = lastIntersectingIndex + 1;
        PAGE_NUM_INPUT.value = pageNum;

        // Debouncing the heavy page loading logic to ignore pages flew past during rapid jumps
        if (loadTimeout) clearTimeout(loadTimeout);
        loadTimeout = setTimeout(() => {
            loadPagesInRange();
        }, 50); 
    }
}, observerOptions);


// Loading new pages from pdf file
async function loadPDF(file) {
    originalFileName = file.name || 'document.pdf';

    const arrayBuffer = await file.arrayBuffer();
    originalPdfBytes = arrayBuffer.slice(0);
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const lastPageIndex = pdfPages.length;

    changeStateLoaded(true);
    executeAction(new AddFileAction(pdfPages.length, file), true);

    // Locking in a unique ID for this specific document load instance
    currentBackgroundIndexId++;
    const indexId = currentBackgroundIndexId;

    // Loop through document layout footprints rapidly
    for (let i = 1; i <= pdf.numPages; i++) {
        const pageProxy = await pdf.getPage(i);
        const viewport = pageProxy.getViewport({ scale: currentZoom });
        const id = `page-${Date.now()}-${i}`;

        // Wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';

        //Main page element
        const pageEl = document.createElement('div');
        pageEl.className = 'pdf-page-skeleton';
        pageEl.id = id;
        pageEl.style.width = `${viewport.width}px`;
        pageEl.style.height = `${viewport.height}px`;

        // Sidebar element
        const sidebarEl = document.createElement('div');
        sidebarEl.className = 'pdf-page-sidebar';
        sidebarEl.style.height = `${viewport.height}px`;

        // Page number indicator
        const numIndicator = document.createElement('div');
        numIndicator.className = 'sidebar-page-num';

        // Page delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'sidebar-delete-btn';
        deleteBtn.innerHTML = '<img src="./assets/trash-icon.svg" style="width: 50px; height: 50px;" alt="icon">';
        deleteBtn.dataset.pageId = id;
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            executeAction(new DeletePageAction(id), true);
        });

        // Page dragger
        const dragHandle = document.createElement('div');
        dragHandle.className = 'sidebar-drag-handle';
        dragHandle.innerHTML = '<img src="./assets/drag-icon.svg" style="width: 30px; height: 30px;" alt="icon" draggable="false">';
        dragHandle.addEventListener('mousedown', (e) => {
            const pageObj = pdfPages.find(p => p.id === id);
            if (pageObj) initiatePageDrag(e, pageObj);
        });

        sidebarEl.appendChild(numIndicator);
        sidebarEl.appendChild(deleteBtn);
        sidebarEl.appendChild(dragHandle);
        wrapper.appendChild(pageEl);
        wrapper.appendChild(sidebarEl);

        // Observing page and adding it to DOM
        pageObserver.observe(pageEl);
        container.appendChild(wrapper);

        // Pushing with null text values instantly to let background workers fetch them later
        pdfPages.push({
            id: id,
            proxy: pageProxy,
            viewport: viewport,
            isLoaded: false,
            wrapper: wrapper,
            element: pageEl,
            sidebar: sidebarEl,
            textIndex: null,
            textContentCache: null,
            redactions: []
        });
    }

    updatePageCount();
    jumpToPage(lastPageIndex);

    // Execute the non-blocking background crawler pass
    indexDocumentTextBackground(indexId);
}


// Function for populating text indexes of pages in the background to reduce loading bottleneck
async function indexDocumentTextBackground(indexId) {
    for (let i = 0; i < pdfPages.length; i++) {
        // Aborting processing immediately if the document changed or closed
        if (indexId !== currentBackgroundIndexId) return;

        const pageObj = pdfPages[i];

        if (!pageObj.textIndex) {
            try {
                // Pre-warming the cache for loadPage() simultaneously
                if (!pageObj.textContentCache) {
                    pageObj.textContentCache = await pageObj.proxy.getTextContent();
                }

                pageObj.textIndex = pageObj.textContentCache.items.map(item => ({
                    str: item.str,
                    transform: item.transform,
                    width: item.width,
                    height: item.height
                }));

                // If the user has an active search text running, updating matching rules live
                if (currentSearchQuery && currentSearchQuery.trim()) {
                    updateMatchesList();
                    if (pageObj.isLoaded) {
                        applyHighlights(pageObj);
                    }
                }
            } catch (err) {
                console.error(`Failed background text index routine on page ${i + 1}:`, err);
            }
        }

        // Periodically yielding control back to the main UI thread loop to ensure a fluid 60 FPS experience
        if (i % 3 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
}


// Jumping to page by index
function jumpToPage(index) {
    const targetPageObj = pdfPages[index];
    if (targetPageObj && targetPageObj.element) {
        const elementPosition = targetPageObj.element.offsetTop;
        const offsetPosition = elementPosition - HEADER_OFFEST;
        
        // Clearing pending scroll-induced loads immediately
        if (loadTimeout) clearTimeout(loadTimeout);
        
        // Proactively synchronizing state variables immediately
        pageNum = index + 1;
        PAGE_NUM_INPUT.value = pageNum;
        
        // Scrolling to position
        container.scrollTo({
            top: offsetPosition,
            behavior: 'auto'
        });
        
        // Forcing evaluation of the target range
        loadPagesInRange();
    }
}


// Loading a specific page by generating its canvas and text layer
async function loadPage(pageObj) {
    // Preventing duplicate overlapping render passes on a page already loading
    if (pageObj.isLoaded || pageObj.isLoading) return;

    pageObj.isLoading = true;

    // Setting up Canvas
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
        // Storing the canvas render task to allow canceling it mid-operation if unviewed
        pageObj.renderTask = pageObj.proxy.render(renderContext);
        await pageObj.renderTask.promise;
        pageObj.renderTask = null;

        if (!pageObj.isLoading) return;

        // Highlight layer
        const highlightLayerDiv = document.createElement('div');
        highlightLayerDiv.className = 'pdf-highlight-layer';
        highlightLayerDiv.style.width = `${pageObj.viewport.width}px`;
        highlightLayerDiv.style.height = `${pageObj.viewport.height}px`;

        // Redaction layer
        const redactionLayerDiv = document.createElement('div');
        redactionLayerDiv.className = 'pdf-redaction-layer';
        redactionLayerDiv.style.width = `${pageObj.viewport.width}px`;
        redactionLayerDiv.style.height = `${pageObj.viewport.height}px`;

        // Text layer
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        textLayerDiv.style.width = `${pageObj.viewport.width}px`;
        textLayerDiv.style.height = `${pageObj.viewport.height}px`;
        textLayerDiv.style.setProperty('--scale-factor', pageObj.viewport.scale);

        // Retrieving text metrics or parsing them via worker if missing
        if (!pageObj.textContentCache) {
            pageObj.textContentCache = await pageObj.proxy.getTextContent();
        }
        const textContent = pageObj.textContentCache;

        if (!pageObj.isLoading) return;

        pageObj.element.appendChild(canvas);
        pageObj.element.appendChild(highlightLayerDiv);
        pageObj.element.appendChild(redactionLayerDiv);
        pageObj.element.appendChild(textLayerDiv);

        // Rendering text layer
        pageObj.textLayerTask = pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: pageObj.viewport,
            textDivs: []
        });
        await pageObj.textLayerTask.promise;
        pageObj.textLayerTask = null;

        // Final verification check before concluding configuration setup
        if (!pageObj.isLoading) return;

        // Finalizing state
        pageObj.element.classList.add('pdf-page-rendered');
        pageObj.isLoaded = true;
        pageObj.isLoading = false;

        applyHighlights(pageObj);
        applyRedactions(pageObj);
    } catch (error) {
        pageObj.isLoading = false;
        pageObj.renderTask = null;
        pageObj.textLayerTask = null;
        
        // Catching and suppressing expected pdf.js cancellation exceptions
        if (error.name !== 'RenderingCancelledException' && !error.message?.includes('cancelled')) {
            console.error('Error rendering page or text layer:', error);
        }
    }
}


// Unloading a specific page
function unloadPage(pageObj) {
    // Terminating canvas rendering pipelines immediately
    if (pageObj.renderTask) {
        pageObj.renderTask.cancel();
        pageObj.renderTask = null;
    }
    // Terminating text layer mapping pipelines immediately
    if (pageObj.textLayerTask && typeof pageObj.textLayerTask.cancel === 'function') {
        pageObj.textLayerTask.cancel();
        pageObj.textLayerTask = null;
    }

    pageObj.isLoading = false;

    // Only clearing assets if the page was previously rendered or marked loaded
    pageObj.element.innerHTML = '';
    pageObj.element.classList.remove('pdf-page-rendered');
    pageObj.isLoaded = false;
}


// Highlighting all text matching the search query from the search index in a specified page
const metricMeasurer = document.createElement('canvas').getContext('2d');
function applyHighlights(pageObj) {
    const highlightLayerDiv = pageObj.element.querySelector('.pdf-highlight-layer');
    if (!highlightLayerDiv) return;

    // Resetting the highlight layer for this page
    highlightLayerDiv.innerHTML = '';

    if (!currentSearchQuery || !currentSearchQuery.trim() || !pageObj.textIndex) return;

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

            // Detecting RTL to fix horizontal mapping orientation
            const highlightLeft = /[\u0590-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(item.str) ? tx[4] + totalWidth - leftOffset - matchWidth : tx[4] + leftOffset;

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

            highlight.style.left = `${highlightLeft}px`;
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
function updateMatchesList() {
    allMatches = [];
    if (!currentSearchQuery || !currentSearchQuery.trim()) {
        currentMatchIndex = -1;
        totalNumEl.textContent = '0';
        currentNumEl.textContent = '0';
        return;
    }

    const queryLower = currentSearchQuery.toLowerCase();

    // Looping through document in order
    pdfPages.forEach(pageObj => {
        if (!pageObj.textIndex) return;
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
    } else {
        currentMatchIndex = -1;
        currentNumEl.textContent = '0';
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
async function loadPagesInRange() {
    // Increment generation ID to instantly invalidate any previously running sequence loops
    currentLoadSequenceId++;
    const sequenceId = currentLoadSequenceId;

    const start = Math.max(0, pageNum - 1 - PAGE_LOAD_RANGE);
    const end = Math.min(pdfPages.length - 1, pageNum - 1 + PAGE_LOAD_RANGE);

    // 1. Instantly clean up out-of-bounds pages to free memory pipelines
    for (let i = 0; i < pdfPages.length; i++) {
        if (i < start || i > end) {
            unloadPage(pdfPages[i]);
        }
    }

    // 2. Identify the specific target pages that require rendering configuration
    const pagesToLoad = [];
    for (let i = start; i <= end; i++) {
        if (!pdfPages[i].isLoaded && !pdfPages[i].isLoading) {
            pagesToLoad.push(pdfPages[i]);
        }
    }

    // 3. Sort targets by physical proximity to the user's current viewpoint (closest first)
    const centerIndex = pageNum - 1;
    pagesToLoad.sort((a, b) => {
        const distA = Math.abs(pdfPages.indexOf(a) - centerIndex);
        const distB = Math.abs(pdfPages.indexOf(b) - centerIndex);
        return distA - distB;
    });

    // 4. Process the queue sequentially to keep the main thread fully responsive
    for (const pageObj of pagesToLoad) {
        // If the user scrolls or jumps during execution, abort this entire stale queue immediately
        if (sequenceId !== currentLoadSequenceId) return;

        // Load the page and wait for it to complete before moving to the next neighbor
        await loadPage(pageObj);
    }
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
        // Increment token to invalidate any running background index loops instantly
        currentBackgroundIndexId++;

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

    // Saving new zoom to local storage
    localStorage.setItem('pdf_zoom', currentZoom);

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
            executeAction(new MovePageAction(oldIndex, newIndex), true);
            
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
                executeAction(new RedactionAction(drawingPageObj.id, rectData), true);
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
            executeAction(new RedactionAction(drawingPageObj.id, data), true);
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
                        executeAction(new RedactionAction(targetPageId, data), true);
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


// Function for taking a search match, calculating the rect boundaries and returning the rect data of it for redaction
function genMatchRectData(matchIndex) {
    const match = allMatches[matchIndex];
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

    // Detecting RTL based the first character of the query
    const isRTL = /[\u0590-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(currentSearchQuery.charAt(0));

    let textBeforeMatch = item.str.substring(0, startIdx);
    let targetMatchText = item.str.substring(startIdx, startIdx + currentSearchQuery.length);

    // Adjusting string splits if skipping the first letter
    if (skipFirstLetter && currentSearchQuery.length > 1) {
        textBeforeMatch = item.str.substring(0, startIdx + 1);
        targetMatchText = item.str.substring(startIdx + 1, startIdx + currentSearchQuery.length);
    }

    const unscaledLeftOffset = metricMeasurer.measureText(textBeforeMatch).width;
    const unscaledMatchWidth = metricMeasurer.measureText(targetMatchText).width;

    const leftOffset = unscaledLeftOffset * scalingRatio;
    const matchWidth = unscaledMatchWidth * scalingRatio;

    // RTL positioning maps right-to-left
    const highlightLeft = isRTL ? tx[4] + totalWidth - leftOffset - matchWidth : tx[4] + leftOffset;
    const highlightTop = tx[5] - (height * 0.82);

    // Adding paddingto bounds
    const padding = Math.max(Math.min(0.1 * height, 5), 2);
    let paddedX, paddedWidth;

    if (skipFirstLetter) {
        // Skipping padding side of skipped first character
        if (isRTL) {
            paddedX = highlightLeft - padding;
            paddedWidth = matchWidth + padding;
        } else {
            paddedX = highlightLeft;
            paddedWidth = matchWidth + padding;
        }
    } else {
        paddedX = highlightLeft - padding;
        paddedWidth = matchWidth + (padding * 2);
    }

    const paddedY = highlightTop - padding;
    const paddedHeight = height + (padding * 2);

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
}

// Redact current button
document.getElementById('redact-current-btn').addEventListener('click', () => {
    if (!currentSearchQuery || !currentSearchQuery.trim() || allMatches.length === 0) return;

    // Getting rectangle data and executing redaction action for it
    const rectData = genMatchRectData(currentMatchIndex);
    executeAction(new RedactionAction(rectData.pageId, rectData), true);

    // Moving to next redaction
    navigateMatch(1);
});

// Redact from button
document.getElementById('redact-from-btn').addEventListener('click', () => {
    if (!currentSearchQuery || !currentSearchQuery.trim() || allMatches.length === 0 || !(confirm(translations[lang]['redactAllWarning']))) return;
    const dataList = [];

    // Iterating over all search matches starting at the current match index to skip all matches before it
    for (let i = currentMatchIndex; i < allMatches.length; i++) {dataList.push(genMatchRectData(i))};

    // Executing redact all action with list of match redactions
    executeAction(new RedactAllAction(dataList), true);
});

// Skip first letter button toggle
const skipFirstBtn = document.getElementById('skip-first-btn');
skipFirstBtn.addEventListener('click', () => {
    // Toggling variable
    skipFirstLetter = !skipFirstLetter;

    // Updating button active state
    skipFirstLetter ? skipFirstBtn.classList.add('active') : skipFirstBtn.classList.remove('active');
});

// Zoom Selector Element Listener Handler
const zoomInput = document.getElementById('zoom-input');
zoomInput.value = `${currentZoom * 100}%`;
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

// Undoing last action by removing it from undo stack, calling it's undo function and adding it to the redo stack
function undoAction() {
    if (undoStack.length === 0) return;

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

    
    if (actionToUndo.type === 'add-file') {
        // If the undone action is file adding we clear the redo list since that action cannot be redone due to reloading matching issues
        redoStack = [];
    } else {
        // Otherwise adding undone action to redo stack
        redoStack.push(actionToUndo);
    }

    // Jumping to undo location
    if (targetIndex + 1 !== pageNum) jumpToPage(targetIndex);

    if (undoStack.length === 0) changeStateLoaded(false);
    //console.log(undoStack);
}

// Redoing last action by removing it from redo stack and executing it
function redoAction() {
    if (redoStack.length === 0) return;

    if (undoStack.length === 0) changeStateLoaded(true);

    // Removing action from stack
    const actionToRedo = redoStack.pop();
    executeAction(actionToRedo, false);

    //console.log(redoStack);
}

// keyboard shortcut action listener
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        switch(e.code) {
            // Undo: ctrl + Z
            case 'KeyZ':
                e.preventDefault();
                undoAction();
                break;
            
            // Redo: ctrl + Y
            case 'KeyY':
                redoAction();
                break;

            // Add file: ctrl + O
            case 'KeyO':
                e.preventDefault();
                fileInput.click();
                break;
            
            // Clear all: ctrl + del
            case 'Delete':
                if (!document.getElementById('clear-btn').classList.contains('disabled') && confirm(translations[lang]['clearAllWarn'])) changeStateLoaded(false);
                break;
            
            // Export: ctrl + E/S
            case 'KeyE':
            case 'KeyS':
                e.preventDefault();
                toggleExportMenu(true);
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
const exportMenu = document.getElementById('export-modal-overlay');
const finalExportBtn = document.getElementById('final-export-btn');
const previewNumLabel = document.getElementById('export-preview-num');

exportBtn.addEventListener('click', () => {toggleExportMenu(true)});

function toggleExportMenu(state) {
    if (state) {
        exportMenu.classList.remove('hidden');
        exportPreviewIndex = 0;
        updateExportPreview();
    } else {
        exportMenu.classList.add('hidden');
    }
}

// Rendering the currently selected page and its active redactions inside the export preview container.
async function updateExportPreview() {
    if (pdfPages.length === 0) return;

    // Boundary protection safety checks
    if (exportPreviewIndex < 0) exportPreviewIndex = 0;
    if (exportPreviewIndex >= pdfPages.length) exportPreviewIndex = pdfPages.length - 1;

    // Syncing the DOM page counters
    if (previewNumLabel) {
        previewNumLabel.innerText = exportPreviewIndex + 1;
    }

    const container = document.querySelector('.preview-canvas-container');

    // Clearing old canvas instances to prevent DOM leakage
    container.innerHTML = '';

    const pageObj = pdfPages[exportPreviewIndex];
    if (!pageObj || !pageObj.proxy) return;

    // Creating a clean preview canvas element
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    container.appendChild(canvas);

    // Calculating responsive scale factor to fit 210px layout viewport width
    const baseViewport = pageObj.proxy.getViewport({ scale: 1.0 });
    const previewScale = 210 / baseViewport.width;
    const viewport = pageObj.proxy.getViewport({ scale: previewScale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const renderContext = {
        canvasContext: ctx,
        viewport: viewport
    };

    try {
        // Rendering the base PDF background layer
        await pageObj.proxy.render({
            canvasContext: ctx,
            viewport: viewport
        }).promise;

        const scaleFactor = viewport.width / pageObj.viewport.width;
        
        ctx.save();
        ctx.scale(scaleFactor, scaleFactor);

        // Rendering the redactions based on the 3 types
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
                
                // Handling multiline formatting
                const lines = item.text.split('\n');
                lines.forEach((line, index) => {
                    ctx.fillText(line, item.x, item.y + (index * item.size * 1.2));
                });
            }
            ctx.restore();
        });

        ctx.restore();

    } catch (error) {
        console.error('Export menu preview rendering exception:', error);
    }
}

document.getElementById('preview-prev-btn')?.addEventListener('click', () => {
    if (exportPreviewIndex > 0) {
        exportPreviewIndex--;
        updateExportPreview();
    }
});

document.getElementById('preview-next-btn')?.addEventListener('click', () => {
    if (pdfPages && exportPreviewIndex < pdfPages.length - 1) {
        exportPreviewIndex++;
        updateExportPreview();
    }
});

document.getElementById('close-export-btn').addEventListener('click', () => {toggleExportMenu(false)});

finalExportBtn.addEventListener('click', () => {exportPDF(
    document.getElementById('export-scale-select').value,
    document.getElementById('export-page-numbers-toggle').checked,
    document.getElementById('export-position-select').value
)});

// Secure PDF Export Pipeline
async function exportPDF(exportScale, addNums, numsPosition) {
    console.log()
    if (isExporting || !loadedState || pdfPages.length === 0) return;

    const originalText = finalExportBtn.innerText;
    isExporting = true;
    
    // Toggling processing state UI
    finalExportBtn.innerText = translations[lang]['exporting'];
    finalExportBtn.classList.add('disabled');

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
        for (let i = 0; i < pdfPages.length; i++) {
            const pageObj = pdfPages[i];
            const hasRedactions = pageObj.redactions && pageObj.redactions.length > 0;
            let page = null;

            if (!hasRedactions && srcDoc) {
                // If a page has no redactions, we use the original page content
                const origIndex = pageObj.proxy.pageNumber - 1;
                [copiedPage] = await finalPdfDoc.copyPages(srcDoc, [origIndex]);
                page = finalPdfDoc.addPage(copiedPage);
            } else {
                // Flattening pages containing redactions
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
                page = finalPdfDoc.addPage([baseViewport.width, baseViewport.height]);
                
                // Overlaying image snapshot across page
                page.drawImage(embeddedImg, {
                    x: 0,
                    y: 0,
                    width: baseViewport.width,
                    height: baseViewport.height
                });
            }

            // Adding page numbers
            if (addNums) {
                const pageNumText = String(i + 1);
                const fontSize = 12;
                const padding = 24;
                const baseViewport = pageObj.proxy.getViewport({ scale: 1.0 });
                const approxTextWidth = pageNumText.length * (fontSize * 0.6);
                
                let x = padding;
                let y = padding;

                switch (numsPosition) {
                    case 'top-left':
                        x = padding;
                        y = baseViewport.height - padding - fontSize;
                        break;
                    case 'top-center':
                        x = (baseViewport.width / 2) - (approxTextWidth / 2);
                        y = baseViewport.height - padding - fontSize;
                        break;
                    case 'top-right':
                        x = baseViewport.width - padding - approxTextWidth;
                        y = baseViewport.height - padding - fontSize;
                        break;
                    case 'bottom-left':
                        x = padding;
                        y = padding;
                        break;
                    case 'bottom-center':
                        x = (baseViewport.width / 2) - (approxTextWidth / 2);
                        y = padding;
                        break;
                    case 'bottom-right':
                    default:
                        x = baseViewport.width - padding - approxTextWidth;
                        y = padding;
                        break;
                }

                page.drawText(pageNumText, {
                    x: x,
                    y: y,
                    size: fontSize,
                    color: PDFLib.rgb(0, 0, 0) 
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
        finalExportBtn.innerText = originalText;
        finalExportBtn.classList.remove('disabled');
        isExporting = false;
        toggleExportMenu(false);
    }
}