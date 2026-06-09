// Base class for all undoable actions
class BaseAction {
    constructor(type, pageId = null) {
        this.type = type;
        this.pageId = pageId;
        this.timestamp = Date.now();
    }

    execute() {throw new Error("execute() must be implemented by a subclass");}

    undo() {throw new Error("undo() must be implemented by a subclass");}
}

class DeletePageAction extends BaseAction {
    constructor(pageId) {
        super('delete-page', pageId);
        this.deletedPageObj = null;
        this.originalIndex = -1;
    }

    execute() {
        // Finding page object in array from id
        const pages = AppManager.getPages();
        this.originalIndex = pages.findIndex(p => p.id === this.pageId);

        if (this.originalIndex === -1) {
            console.error(`Page with ID ${this.pageId} not found in state tracker.`);
            return;
        }

        // Removing the data object from the pages array to cache it locally
        this.deletedPageObj = pages.splice(this.originalIndex, 1)[0];

        // Detaching the physical element wrapper from the scroll container layout
        if (this.deletedPageObj.wrapper && this.deletedPageObj.wrapper.parentNode) {
            this.deletedPageObj.wrapper.parentNode.removeChild(this.deletedPageObj.wrapper);
        }

        AppManager.refreshUI();
    }

    undo() {
        const pages = AppManager.getPages();
        const container = AppManager.getContainer();

        // Adding page object back into array
        pages.splice(this.originalIndex, 0, this.deletedPageObj);

        // Inserting deleted page back into DOM
        const referenceNode = pages[this.originalIndex + 1] ? pages[this.originalIndex + 1].wrapper : null;
        container.insertBefore(this.deletedPageObj.wrapper, referenceNode);

        AppManager.refreshUI();
        return this.originalIndex;
    }
}

class MovePageAction extends BaseAction {
    constructor(fromIndex, toIndex) {
        super('move-page');
        this.fromIndex = fromIndex;
        this.toIndex = toIndex;
    }

    execute() {this.performMove(this.fromIndex, this.toIndex);}

    undo() {
        this.performMove(this.toIndex, this.fromIndex);
        return this.fromIndex;
    }

    performMove(from, to) {
        const pages = AppManager.getPages();
        const container = AppManager.getContainer();

        // Safety boundries check
        if (from < 0 || from >= pages.length || to < 0 || to >= pages.length) {
            console.error("Move boundaries out of bounds:", from, to);
            return;
        }

        const draggedPageObj = pages[from];
        const targetPageObj = pages[to];

        // Determine DOM reference before array mutation
        let referenceNode;
        if (to > from) {
            referenceNode = targetPageObj.wrapper.nextSibling;
        } else {
            referenceNode = targetPageObj.wrapper;
        }

        // Moving page object in array
        pages.splice(from, 1);
        pages.splice(to, 0, draggedPageObj);

        // Moving element in DOM
        container.insertBefore(draggedPageObj.wrapper, referenceNode);

        AppManager.refreshUI();
    }
}

class AddFileAction extends BaseAction {
    constructor(startIndex) {
        super('add-file');
        this.startIndex = startIndex;
    }

    execute() {/*Done in loadPdf function*/}

    undo() {
        const container = AppManager.getContainer();
        
        // Removing all pages from startIndex to the end of array
        const removedPages = AppManager.getPages().splice(this.startIndex);
        
        // Remove their wrappers from the DOM
        removedPages.forEach(page => {
            if (page.wrapper) {
                container.removeChild(page.wrapper);
            }
        });

        AppManager.refreshUI();
        return this.startIndex;
    }
}

// Singular redaction action for rectangles, paint strokes and text since.
// Rendering is done per page load, action only effects data in page redactions array
class RedactionAction extends BaseAction {
    constructor(pageId, data) {
        super(data.type, pageId);
        this.data = data;
    }

    execute() {
        const pages = AppManager.getPages();
        const pageObj = pages.find(p => p.id === this.pageId);
        if (!pageObj) return;

        // Adding rectangle data to page redactions array
        pageObj.redactions.push(this.data);

        // Re-rendering redactions
        if (pageObj.isLoaded) {
            applyRedactions(pageObj);
        }
    }

    undo() {
        const pages = AppManager.getPages();
        const pageObj = pages.find(p => p.id === this.pageId);
        if (!pageObj) return;

        // Removing specific box object reference from the array
        const index = pageObj.redactions.findIndex(item => item.id === this.data.id);
        if (index !== -1) {
            pageObj.redactions.splice(index, 1);
        }

        // Re-rendering redactions
        if (pageObj.isLoaded) {
            applyRedactions(pageObj);
        }

        // Returning the target page index
        return pages.indexOf(pageObj);
    }
}

class RedactAllAction extends BaseAction {
    constructor(dataList) {
        super('redact-all');
        this.dataList = dataList;
        this.actionList = [];
    }

    execute() {
        // Creating redaction for each data in the list and executing it
        this.dataList.forEach((data) => {
            const redaction = new RedactionAction(data.pageId, data);
            redaction.execute();
            this.actionList.push(redaction);
        });

    }

    undo() {
        // Iterating of all saved action in the list to undo them
        this.actionList.forEach((action) => {
            action.undo();
        });

        // Returning index of first page with a redaction that was undone
        const firstPageId = this.actionList[0].pageId;
        const pages = AppManager.getPages();
        return pages.findIndex(p => p.id === firstPageId);
    }
}