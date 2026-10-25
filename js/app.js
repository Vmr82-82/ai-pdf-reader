// =============================================================================
// AI PDF Reader Lite - Main Application Engine
// =============================================================================

import * as pdfjsLib from '../vendor/pdf.min.mjs';
import { Storage } from './storage.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';

class ReaderApp {
  constructor() {
    this.currentDoc = null;
    this.docId = null;
    this.pdfDoc = null;
    this.currentPage = 1;
    this.totalPages = 0;
    this.scale = 1.35;
    this.activeColor = 'amber'; // amber, emerald, cyan, violet, rose
    this.isHighlightMode = true; // Active highlighter by default
    this.currentTheme = 'theme-charcoal';
    this.highlights = [];
    this.isRendering = false;
    this.pendingPage = null;

    this.initElements();
    this.updateActiveColorStyle();
    this.setMode(true);
    this.initEvents();
    this.initSettingsAndLastDoc();
  }

  initElements() {
    this.viewerContainer = document.getElementById('viewerContainer');
    this.pageWrapper = document.getElementById('pageWrapper');
    this.pdfCanvas = document.getElementById('pdfCanvas');
    this.textLayerDiv = document.getElementById('textLayer');
    this.highlightLayer = document.getElementById('highlightLayer');
    this.fileInput = document.getElementById('fileInput');

    // Toolbar
    this.docTitle = document.getElementById('docTitle');
    this.pageInput = document.getElementById('pageInput');
    this.totalPagesEl = document.getElementById('totalPages');
    this.prevBtn = document.getElementById('prevBtn');
    this.nextBtn = document.getElementById('nextBtn');
    this.zoomInBtn = document.getElementById('zoomInBtn');
    this.zoomOutBtn = document.getElementById('zoomOutBtn');
    this.themeBtn = document.getElementById('themeBtn');
    this.openDrawerBtn = document.getElementById('openDrawerBtn');
    this.hlBadge = document.getElementById('hlBadge');
    this.modeToggleBtn = document.getElementById('modeToggleBtn');
    this.modeText = document.getElementById('modeText');

    // Drawers & Popovers
    this.drawer = document.getElementById('highlightsDrawer');
    this.closeDrawerBtn = document.getElementById('closeDrawerBtn');
    this.highlightsList = document.getElementById('highlightsList');
    this.exportBtn = document.getElementById('exportBtn');
    this.hlPopover = document.getElementById('hlPopover');
    this.toast = document.getElementById('toast');
  }

  initEvents() {
    // Open file
    document.getElementById('openFileBtn').addEventListener('click', () => {
      if (window.AndroidBridge && typeof window.AndroidBridge.openNativePdfPicker === 'function') {
        window.AndroidBridge.openNativePdfPicker();
      } else {
        this.fileInput.click();
      }
    });
    this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

    // Page navigation
    this.prevBtn.addEventListener('click', () => this.changePage(-1));
    this.nextBtn.addEventListener('click', () => this.changePage(1));
    this.pageInput.addEventListener('change', () => {
      const p = parseInt(this.pageInput.value, 10);
      if (p >= 1 && p <= this.totalPages) {
        this.renderPage(p);
      }
    });

    // Zoom
    this.zoomInBtn.addEventListener('click', () => {
      this.scale = Math.min(3.0, this.scale + 0.15);
      this.renderPage(this.currentPage);
    });
    this.zoomOutBtn.addEventListener('click', () => {
      this.scale = Math.max(0.7, this.scale - 0.15);
      this.renderPage(this.currentPage);
    });

    // Palette dots (Amber, Emerald, Cyan, Violet, Rose)
    document.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        this.activeColor = dot.dataset.color;
        this.updateActiveColorStyle();
        this.setMode(true); // Automatically activates highlight mode
        this.showToast(`Highlighter: ${this.activeColor.toUpperCase()}`);
      });
    });

    // Mode Toggle Button (Highlight vs Scroll)
    this.modeToggleBtn.addEventListener('click', () => {
      this.toggleMode();
    });

    // Theme toggle
    this.themeBtn.addEventListener('click', () => this.cycleTheme());

    // Highlights Drawer
    this.openDrawerBtn.addEventListener('click', () => this.openDrawer());
    this.closeDrawerBtn.addEventListener('click', () => this.closeDrawer());
    this.exportBtn.addEventListener('click', () => this.exportHighlights());

    // Gestures for swipe/scroll page navigation
    this.initGestures();

    // Drag-to-highlight engine (character-snapping, zero delay)
    this.initHighlightEngine();

    // Text Selection for Stylus / Pen / Touch across window
    window.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    window.addEventListener('touchend', (e) => this.handlePointerUp(e));

    // Keyboard navigation (desktop / bluetooth keyboard on tablet)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        this.changePage(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        this.changePage(-1);
      }
    });

    // Close popover when clicking elsewhere
    document.addEventListener('click', (e) => {
      if (!this.hlPopover.contains(e.target) && !e.target.classList.contains('hl-box')) {
        this.hlPopover.style.display = 'none';
      }
    });
  }

  async initSettingsAndLastDoc() {
    const savedTheme = await Storage.getSetting('theme', 'theme-charcoal');
    this.applyTheme(savedTheme);

    // If Android launched with a PDF or has pending intent, prioritize opening that document
    if (window.AndroidBridge) {
      if (typeof window.AndroidBridge.notifyAppReady === 'function') {
        window.AndroidBridge.notifyAppReady();
      }
      if (typeof window.AndroidBridge.hasPendingPdf === 'function' && window.AndroidBridge.hasPendingPdf()) {
        const name = window.AndroidBridge.getPendingPdfName ? window.AndroidBridge.getPendingPdfName() : 'Document.pdf';
        const url = 'https://appassets.androidplatform.net/assets/current_pdf_stream?t=' + Date.now();
        await this.loadPdfFromUrl(url, name);
        return;
      }
    }

    const lastDoc = await Storage.getLatestDocument();
    if (lastDoc && lastDoc.data) {
      this.loadPdfFromArrayBuffer(lastDoc.data, lastDoc.name, lastDoc.id);
    }
  }

  applyTheme(theme) {
    this.currentTheme = theme;
    document.body.className = theme;
    const names = {
      'theme-oled': '🌙 OLED Night',
      'theme-charcoal': '🔮 Charcoal Night',
      'theme-sepia': '📜 Warm Sepia',
      'theme-day': '☀️ Day Paper'
    };
    this.themeBtn.innerHTML = names[theme] || 'Theme';
    Storage.saveSetting('theme', theme);
  }

  cycleTheme() {
    const themes = ['theme-oled', 'theme-charcoal', 'theme-sepia', 'theme-day'];
    let idx = themes.indexOf(this.currentTheme);
    idx = (idx + 1) % themes.length;
    this.applyTheme(themes[idx]);
  }

  async handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) return;
    const buffer = await file.arrayBuffer();
    const docId = 'doc_' + file.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    await Storage.saveDocument(docId, file.name, buffer);
    this.loadPdfFromArrayBuffer(buffer, file.name, docId);
  }

  async loadPdfFromArrayBuffer(buffer, name, id) {
    try {
      this.docTitle.textContent = name;
      this.docId = id;
      this.pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;
      this.totalPages = this.pdfDoc.numPages;
      this.totalPagesEl.textContent = this.totalPages;

      // Load saved page
      const savedPage = await Storage.getSetting(`last_page_${this.docId}`, 1);
      this.currentPage = Math.min(Math.max(1, savedPage), this.totalPages);

      // Load highlights for this document
      this.highlights = await Storage.getHighlightsForDoc(this.docId);
      this.updateHighlightBadge();

      this.renderPage(this.currentPage);
      this.showToast(`Loaded: ${name}`);
    } catch (err) {
      console.error(err);
      this.showToast('Could not load PDF document', 'error');
    }
  }

  async loadPdfFromUrl(url, name) {
    try {
      this.showToast(`Opening: ${name}...`);
      this.docTitle.textContent = name;
      const docId = 'doc_' + name.replace(/[^a-zA-Z0-9_-]/g, '_');

      let arrayBuffer = null;

      // 1. First attempt: fetch from streaming URL
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          arrayBuffer = await resp.arrayBuffer();
        } else {
          console.warn('Fetch stream returned HTTP', resp.status);
        }
      } catch (fetchErr) {
        console.warn('Fetch stream error, trying native bridge fallback:', fetchErr);
      }

      // 2. Second attempt: native bridge Base64 fallback
      if (!arrayBuffer && window.AndroidBridge && typeof window.AndroidBridge.getPdfBase64 === 'function') {
        try {
          const b64 = window.AndroidBridge.getPdfBase64();
          if (b64 && b64.length > 0) {
            const binaryString = atob(b64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            arrayBuffer = bytes.buffer;
          }
        } catch (b64Err) {
          console.warn('Base64 bridge fallback error:', b64Err);
        }
      }

      if (!arrayBuffer) {
        throw new Error('Unable to read PDF data from stream or bridge');
      }

      await Storage.saveDocument(docId, name, arrayBuffer);
      await this.loadPdfFromArrayBuffer(arrayBuffer, name, docId);
    } catch (err) {
      console.error('Error loading PDF from URL:', err);
      this.showToast(`Error: ${err.message || 'Could not load PDF'}`, 'error');
    }
  }

  changePage(delta) {
    const newPage = this.currentPage + delta;
    if (newPage >= 1 && newPage <= this.totalPages) {
      this.renderPage(newPage);
    }
  }

  async renderPage(pageNumber) {
    if (this.isRendering) {
      this.pendingPage = pageNumber;
      return;
    }
    this.isRendering = true;
    this.currentPage = pageNumber;
    this.pageInput.value = pageNumber;
    Storage.saveSetting(`last_page_${this.docId}`, pageNumber);

    try {
      const page = await this.pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: this.scale });

      // Match canvas dimensions to viewport and pixel ratio
      const dpr = window.devicePixelRatio || 1;
      this.pdfCanvas.width = viewport.width * dpr;
      this.pdfCanvas.height = viewport.height * dpr;
      this.pdfCanvas.style.width = `${viewport.width}px`;
      this.pdfCanvas.style.height = `${viewport.height}px`;

      this.pageWrapper.style.width = `${viewport.width}px`;
      this.pageWrapper.style.height = `${viewport.height}px`;

      const ctx = this.pdfCanvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const renderContext = {
        canvasContext: ctx,
        viewport: viewport
      };
      await page.render(renderContext).promise;

      // Render Text Layer (Modern PDF.js v5 with fallback)
      this.textLayerDiv.innerHTML = '';
      this.textLayerDiv.style.width = `${viewport.width}px`;
      this.textLayerDiv.style.height = `${viewport.height}px`;

      const textContent = await page.getTextContent();
      if (pdfjsLib.TextLayer) {
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: this.textLayerDiv,
          viewport: viewport
        });
        await textLayer.render();
      } else if (typeof pdfjsLib.renderTextLayer === 'function') {
        await pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          container: this.textLayerDiv,
          viewport: viewport,
          textDivs: []
        }).promise;
      }

      // Render existing highlights for this page
      this.renderHighlightsOnPage();

      if (this.isHighlightMode) {
        this.textLayerDiv.classList.add('highlight-active');
      } else {
        this.textLayerDiv.classList.remove('highlight-active');
      }

    } catch (err) {
      console.error('Render error:', err);
    } finally {
      this.isRendering = false;
      if (this.pendingPage !== null) {
        const next = this.pendingPage;
        this.pendingPage = null;
        this.renderPage(next);
      }
    }
  }

  setMode(highlight) {
    this.isHighlightMode = highlight;
    if (this.modeToggleBtn && this.modeText) {
      if (this.isHighlightMode) {
        this.modeToggleBtn.classList.add('highlight-active');
        this.modeText.textContent = 'Highlight';
      } else {
        this.modeToggleBtn.classList.remove('highlight-active');
        this.modeText.textContent = 'Scroll';
      }
    }
    if (this.textLayerDiv) {
      if (this.isHighlightMode) {
        this.textLayerDiv.classList.add('highlight-active');
      } else {
        this.textLayerDiv.classList.remove('highlight-active');
      }
    }
  }

  toggleMode() {
    this.setMode(!this.isHighlightMode);
    this.showToast(this.isHighlightMode ? 'Highlight Mode: ON' : 'Scroll Mode: ON');
  }

  updateActiveColorStyle() {
    const colors = {
      amber: { solid: '#fbbf24', glow: 'rgba(251, 191, 36, 0.45)' },
      emerald: { solid: '#34d399', glow: 'rgba(52, 211, 153, 0.45)' },
      cyan: { solid: '#38bdf8', glow: 'rgba(56, 189, 248, 0.45)' },
      violet: { solid: '#a855f7', glow: 'rgba(168, 85, 247, 0.45)' },
      rose: { solid: '#f43f5e', glow: 'rgba(244, 63, 94, 0.45)' }
    };
    const c = colors[this.activeColor] || colors.amber;
    document.documentElement.style.setProperty('--active-hl', `var(--hl-${this.activeColor})`);
    document.documentElement.style.setProperty('--active-color-solid', c.solid);
    document.documentElement.style.setProperty('--active-hl-glow', c.glow);
  }

  initHighlightEngine() {
    let isDrawing = false;
    let startCaret = null;

    const getCaretAtPoint = (x, y) => {
      if (document.caretRangeFromPoint) {
        return document.caretRangeFromPoint(x, y);
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(x, y);
        if (pos && pos.offsetNode) {
          const range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.setEnd(pos.offsetNode, pos.offset);
          return range;
        }
      }
      return null;
    };

    const handleStart = (clientX, clientY, isPen) => {
      const shouldHighlight = isPen || this.isHighlightMode;
      if (!shouldHighlight) return;

      const caret = getCaretAtPoint(clientX, clientY);
      if (caret && caret.startContainer) {
        isDrawing = true;
        startCaret = caret;
        window.getSelection().removeAllRanges();
      }
    };

    const handleMove = (clientX, clientY) => {
      if (!isDrawing || !startCaret) return;

      const currentCaret = getCaretAtPoint(clientX, clientY);
      if (!currentCaret || !currentCaret.startContainer) return;

      try {
        const range = document.createRange();
        const startNode = startCaret.startContainer;
        const startOff = startCaret.startOffset;
        const endNode = currentCaret.startContainer;
        const endOff = currentCaret.startOffset;

        if (startNode === endNode) {
          range.setStart(startNode, Math.min(startOff, endOff));
          range.setEnd(startNode, Math.max(startOff, endOff));
        } else {
          const cmp = startNode.compareDocumentPosition(endNode);
          if (cmp & Node.DOCUMENT_POSITION_FOLLOWING) {
            range.setStart(startNode, startOff);
            range.setEnd(endNode, endOff);
          } else {
            range.setStart(endNode, endOff);
            range.setEnd(startNode, startOff);
          }
        }

        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (ignored) {}
    };

    const handleEnd = () => {
      if (!isDrawing) return;
      isDrawing = false;
      startCaret = null;

      setTimeout(() => {
        this.processTextSelection();
      }, 40);
    };

    // Pointer events on text layer
    this.textLayerDiv.addEventListener('pointerdown', (e) => {
      handleStart(e.clientX, e.clientY, e.pointerType === 'pen');
    });

    this.textLayerDiv.addEventListener('pointermove', (e) => {
      if (isDrawing) {
        handleMove(e.clientX, e.clientY);
      }
    });

    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', () => {
      isDrawing = false;
      startCaret = null;
    });

    // Touch events for mobile/tablet WebViews
    this.textLayerDiv.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const isPen = t.touchType === 'stylus';
        if (this.isHighlightMode || isPen) {
          handleStart(t.clientX, t.clientY, isPen);
        }
      }
    }, { passive: true });

    this.textLayerDiv.addEventListener('touchmove', (e) => {
      if (isDrawing && e.touches.length === 1) {
        e.preventDefault(); // Stop page scrolling during active highlight drawing!
        const t = e.touches[0];
        handleMove(t.clientX, t.clientY);
      }
    }, { passive: false });

    this.textLayerDiv.addEventListener('touchend', handleEnd);
  }

  initGestures() {
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let isSwiping = false;

    // Detect horizontal swipe on viewer container
    this.viewerContainer.addEventListener('touchstart', (e) => {
      // If highlight mode is active and touch started on textLayer, don't initiate a page swipe
      if (this.isHighlightMode && e.target.closest('#textLayer')) {
        isSwiping = false;
        return;
      }
      if (e.touches.length !== 1) {
        isSwiping = false;
        return;
      }
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
      isSwiping = true;
    }, { passive: true });

    this.viewerContainer.addEventListener('touchmove', (e) => {
      if (!isSwiping || e.touches.length !== 1) return;
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const dx = currentX - touchStartX;
      const dy = currentY - touchStartY;

      // Only give tactile feedback if horizontal movement dominates and there is no active text selection
      const sel = window.getSelection();
      const hasSelection = sel && !sel.isCollapsed && sel.toString().trim().length > 0;
      if (!hasSelection && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 20) {
        this.pageWrapper.style.transition = 'none';
        this.pageWrapper.style.transform = `translateX(${dx * 0.25}px)`;
      }
    }, { passive: true });

    const handleTouchEnd = (e) => {
      if (!isSwiping) return;
      isSwiping = false;
      this.pageWrapper.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
      this.pageWrapper.style.transform = 'translateX(0)';

      const touchEndX = (e.changedTouches && e.changedTouches.length)
        ? e.changedTouches[0].clientX
        : touchStartX;
      const touchEndY = (e.changedTouches && e.changedTouches.length)
        ? e.changedTouches[0].clientY
        : touchStartY;
      const dx = touchEndX - touchStartX;
      const dy = touchEndY - touchStartY;
      const dt = Date.now() - touchStartTime;

      const sel = window.getSelection();
      const hasSelection = sel && !sel.isCollapsed && sel.toString().trim().length > 0;
      if (hasSelection) return; // If selecting text, let highlighter handle it

      // If horizontal flick/swipe was made
      if (Math.abs(dx) > Math.abs(dy) * 1.15 && Math.abs(dx) > 40 && dt < 800) {
        if (dx < -40) {
          // Swipe left -> Next Page
          this.changePage(1);
        } else if (dx > 40) {
          // Swipe right -> Previous Page
          this.changePage(-1);
        }
      }
    };

    this.viewerContainer.addEventListener('touchend', handleTouchEnd);
    this.viewerContainer.addEventListener('touchcancel', () => {
      isSwiping = false;
      this.pageWrapper.style.transform = 'translateX(0)';
    });

    // Horizontal wheel / trackpad scrolling
    let wheelTimer = null;
    this.viewerContainer.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) > 35 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        if (!wheelTimer) {
          if (e.deltaX > 0) this.changePage(1);
          else this.changePage(-1);
          wheelTimer = setTimeout(() => { wheelTimer = null; }, 350);
        }
      }
    }, { passive: true });

    // Edge Tap Navigation (Tapping near right edge goes next, near left edge goes prev)
    this.viewerContainer.addEventListener('click', (e) => {
      if (e.target.closest('#toolbar') || e.target.closest('#highlightsDrawer') || 
          e.target.closest('#hlPopover') || e.target.closest('.hl-box')) {
        return;
      }
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
        return; // Selection in progress
      }

      const screenWidth = window.innerWidth;
      const clickX = e.clientX;

      // Right 12% margin -> Next page
      if (clickX > screenWidth * 0.88) {
        this.changePage(1);
      }
      // Left 12% margin -> Previous page
      else if (clickX < screenWidth * 0.12) {
        this.changePage(-1);
      }
    });
  }

  handlePointerUp(e) {
    // Give browser selection a moment to complete bounding boxes
    setTimeout(() => {
      this.processTextSelection();
    }, 60);
  }

  processTextSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const selectedText = range.toString().trim();
    if (!selectedText) return;

    // Check if selection belongs to pageWrapper
    if (!this.pageWrapper.contains(range.commonAncestorContainer) &&
        this.pageWrapper !== range.commonAncestorContainer) {
      return;
    }

    const wrapperRect = this.pageWrapper.getBoundingClientRect();
    const clientRects = range.getClientRects();
    if (!clientRects || !clientRects.length) return;

    // Convert client rects to relative percentages for responsive scaling
    const rects = [];
    for (let i = 0; i < clientRects.length; i++) {
      const r = clientRects[i];
      if (r.width > 2 && r.height > 2) {
        rects.push({
          left: (r.left - wrapperRect.left) / wrapperRect.width,
          top: (r.top - wrapperRect.top) / wrapperRect.height,
          width: r.width / wrapperRect.width,
          height: r.height / wrapperRect.height
        });
      }
    }

    if (!rects.length) return;

    const newHl = {
      id: 'hl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      docId: this.docId,
      page: this.currentPage,
      text: selectedText,
      color: this.activeColor,
      rects: rects,
      createdAt: Date.now()
    };

    Storage.addHighlight(newHl).then(() => {
      this.highlights.push(newHl);
      this.renderHighlightsOnPage();
      this.updateHighlightBadge();
      this.showToast(`Highlighted in ${this.activeColor.toUpperCase()} ✓`);
      sel.removeAllRanges(); // clean unselect
    }).catch(err => {
      console.error('Save highlight error:', err);
    });
  }

  renderHighlightsOnPage() {
    this.highlightLayer.innerHTML = '';
    const pageHls = this.highlights.filter(h => h.page === this.currentPage);
    const w = this.pageWrapper.clientWidth;
    const h = this.pageWrapper.clientHeight;

    pageHls.forEach(hl => {
      hl.rects.forEach(r => {
        const box = document.createElement('div');
        box.className = `hl-box ${hl.color}`;
        box.style.left = `${r.left * w}px`;
        box.style.top = `${r.top * h}px`;
        box.style.width = `${r.width * w}px`;
        box.style.height = `${r.height * h}px`;

        box.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.showHighlightPopover(hl, ev.clientX, ev.clientY);
        });

        this.highlightLayer.appendChild(box);
      });
    });
  }

  showHighlightPopover(hl, x, y) {
    this.hlPopover.style.display = 'flex';
    this.hlPopover.style.left = `${Math.min(window.innerWidth - 180, x)}px`;
    this.hlPopover.style.top = `${Math.max(10, y - 50)}px`;

    this.hlPopover.innerHTML = `
      <div style="display:flex;gap:4px">
        <span class="color-dot" data-c="amber" style="background:#fbbf24;width:18px;height:18px"></span>
        <span class="color-dot" data-c="emerald" style="background:#34d399;width:18px;height:18px"></span>
        <span class="color-dot" data-c="cyan" style="background:#38bdf8;width:18px;height:18px"></span>
        <span class="color-dot" data-c="violet" style="background:#a855f7;width:18px;height:18px"></span>
        <span class="color-dot" data-c="rose" style="background:#f43f5e;width:18px;height:18px"></span>
      </div>
      <button id="delHlBtn" style="background:transparent;border:none;color:#f43f5e;font-size:16px;cursor:pointer;padding:2px 6px">🗑</button>
      <button id="copyHlBtn" style="background:transparent;border:none;color:#94a3b8;font-size:14px;cursor:pointer;padding:2px 6px">📋</button>
    `;

    this.hlPopover.querySelectorAll('.color-dot').forEach(d => {
      d.addEventListener('click', async () => {
        hl.color = d.dataset.c;
        await Storage.addHighlight(hl);
        this.renderHighlightsOnPage();
        this.hlPopover.style.display = 'none';
        this.showToast('Color updated');
      });
    });

    this.hlPopover.querySelector('#delHlBtn').addEventListener('click', async () => {
      await Storage.deleteHighlight(hl.id);
      this.highlights = this.highlights.filter(h => h.id !== hl.id);
      this.renderHighlightsOnPage();
      this.updateHighlightBadge();
      this.hlPopover.style.display = 'none';
      this.showToast('Highlight deleted');
    });

    this.hlPopover.querySelector('#copyHlBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(hl.text);
      this.hlPopover.style.display = 'none';
      this.showToast('Quote copied to clipboard');
    });
  }

  updateHighlightBadge() {
    this.hlBadge.textContent = this.highlights.length;
  }

  openDrawer() {
    this.drawer.classList.add('open');
    this.renderDrawerList();
  }

  closeDrawer() {
    this.drawer.classList.remove('open');
  }

  renderDrawerList() {
    this.highlightsList.innerHTML = '';
    if (!this.highlights.length) {
      this.highlightsList.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:30px 10px;font-size:13px">No highlights in this document yet. Use your pen to highlight any passage!</div>`;
      return;
    }

    // Sort by page number then created timestamp
    const sorted = [...this.highlights].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);

    sorted.forEach(hl => {
      const card = document.createElement('div');
      card.className = `hl-card ${hl.color}`;
      card.innerHTML = `
        <div class="hl-card-header">
          <span>Page ${hl.page} · ${new Date(hl.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
          <button class="hl-card-del" title="Delete">✕</button>
        </div>
        <div class="hl-card-text">"${hl.text}"</div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('hl-card-del')) return;
        this.closeDrawer();
        if (this.currentPage !== hl.page) {
          this.renderPage(hl.page);
        }
      });

      card.querySelector('.hl-card-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        await Storage.deleteHighlight(hl.id);
        this.highlights = this.highlights.filter(h => h.id !== hl.id);
        this.renderHighlightsOnPage();
        this.updateHighlightBadge();
        this.renderDrawerList();
      });

      this.highlightsList.appendChild(card);
    });
  }

  exportHighlights() {
    if (!this.highlights.length) {
      this.showToast('No highlights to export', 'error');
      return;
    }
    const docName = this.docTitle.textContent || 'Document';
    const sorted = [...this.highlights].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);

    let md = `# Highlights: ${docName}\n\n`;
    let curPage = -1;
    sorted.forEach(hl => {
      if (hl.page !== curPage) {
        curPage = hl.page;
        md += `\n### Page ${curPage}\n`;
      }
      md += `> "${hl.text}"\n\n`;
    });

    navigator.clipboard.writeText(md).then(() => {
      this.showToast('Copied highlights as Markdown for Obsidian! ✓');
    }).catch(() => {
      this.showToast('Could not copy to clipboard', 'error');
    });
  }

  showToast(msg, type = 'info') {
    this.toast.textContent = msg;
    this.toast.className = `show ${type}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast.className = '';
    }, 2800);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.app = new ReaderApp();
  });
} else {
  window.app = new ReaderApp();
}
