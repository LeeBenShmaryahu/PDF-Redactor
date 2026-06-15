# PDF Redactor

This product was built for Israel's Military Advocate General by The Innovation and Information Management Department as a tool for handling, modifying and mostly redacting PDF files for various security reasons.

This web app was developed entirely by myself, you may contact me for any issues or feature requests.

# Features

## File Editing
- **Add File** (ctrl + O) - loads the uploaded PDF file into the site. If a file is already loaded, loading an additional file will append it to the bottom of the current document. This can be used for merging multiple files.
- **Clear all** (ctrl + del) - clears all currently loaded PDF pages.
- **Export** (ctrl + E / ctrl + S) - exports a copy of the PDF as it is currently loaded in the site with all the changes that were made.
- **Page Delete** - pressing the trash icon to the top right of a page will delete it.
- **Page Rearranging** - dragging the icon on the middle right of a page will allow the user to scroll to a new position on the document, releasing the drag will move the dragged page to this location.

## Search
Note that the search will only find instances of text that's saved on the document, meaning that **any text that's embedded in the image will be skipped.**

- **Search Bar** - will look for all matches of the given search query in the document and highlight them.
- The arrow keys can be used for moving between search matches
- **Redact Current Match** - will cover the currently highlighted match with a rectangle and move to the next match.
- **Redact All From Here** - will redact all search matches in the document, starting at the currently highlighted one.
- **Skip First Letter** - this toggles whether the match redaction tools will fully redact the match, or leave the first character visible.

## Redaction Tools
All tools inherit the color from the color picker.

The font selector will prompt the user for access to their system's font list for additional options. If this prompt is declined or fails, it will default to a few select fonts.

- **Rectangle Tool** (ctrl + alt + R) - this tool will draw a rectangle from the point the use originally starts clicking at to where they release the mouse click.
- **Paint Tool** (ctrl + alt + B) - this tool will let the user draw brush stroke using the mouse. The width of the stroke can be adjusted with the size selector.
- **Text Tool** (ctrl + alt + T) - this tool lets the user add rudimentary textboxes to the document. They can be adjusted with the size and font selectors.
- **Zoom Control** - allows for viewing the document at different zoom levels.

## General
- **Undo** (ctrl + Z)
- **Redo** (ctrl + Y)
- **Language Swapping** - the site can switch between English and Hebrew interchangeably based on the user's preference.
- **Help** - the "?" button will lead to this README page for full documentation on this web app


# Security
During export of a document, all pages which have ANY type of redaction in it (this includes rectangles, paint strokes or added text) will have their **page's data completely wiped**, instead being swapped with a high resolution image of the page.
This is done for security reasons, making any form of redaction reversal completely impossible, as all the information a page contains is saved purely visually. This comes at the cost of losing any text features a page might have (such as copying for example), as well as increasing file size due to the high resolution images.

This application is hosted on a GitHub Pages for ease of access, all logic for the web app itself is run completely locally on the user's device.
Any uploaded file does **not** get sent to any third-party services, ensuring safety to upload sensitive files.
The entire codebase for this project is publicly available on this GitHub repository for anyone to view.