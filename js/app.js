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
    this.currentTheme = 'theme-charcoal';
    this.highlights = [];
    this.isRendering = false;
    this.pendingPage = null;

    this.initElements();
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
    this.modeIndicator = document.getElementById('modeIndicator');

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
    document.getElementById('openFileBtn').addEventListener('click', () => this.fileInput.click());
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

    // Palette dots
    document.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        this.activeColor = dot.dataset.color;
        document.documentElement.style.setProperty('--active-hl', `var(--hl-${this.activeColor})`);
        this.showToast(`Highlighter: ${this.activeColor.toUpperCase()}`);
      });
    });

    // Theme toggle
    this.themeBtn.addEventListener('click', () => this.cycleTheme());

    // Drawer
    this.openDrawerBtn.addEventListener('click', () => this.openDrawer());
    this.closeDrawerBtn.addEventListener('click', () => this.closeDrawer());
    this.exportBtn.addEventListener('click', () => this.exportHighlights());

    // Text Selection for Stylus/Pen and Mouse
    this.textLayerDiv.addEventListener('pointerup', (e) => this.handlePointerUp(e));

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

      // Render Text Layer
      this.textLayerDiv.innerHTML = '';
      this.textLayerDiv.style.width = `${viewport.width}px`;
      this.textLayerDiv.style.height = `${viewport.height}px`;

      const textContent = await page.getTextContent();
      await pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container: this.textLayerDiv,
        viewport: viewport,
        textDivs: []
      }).promise;

      // Render existing highlights for this page
      this.renderHighlightsOnPage();

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

  handlePointerUp(e) {
    // DUAL INPUT ENGINE:
    // If pointer was touch, do NOT auto-highlight (allow finger to scroll freely)
    // If pointer was pen or mouse, trigger highlight creation on text selection!
    if (e.pointerType === 'touch') {
      this.modeIndicator.textContent = '👆 Touch Scroll';
      return;
    }

    this.modeIndicator.textContent = '🖊️ Stylus Active';
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const selectedText = range.toString().trim();
    if (!selectedText) return;

    const wrapperRect = this.pageWrapper.getBoundingClientRect();
    const clientRects = range.getClientRects();
    if (!clientRects.length) return;

    // Convert client rects to relative percentages for responsive scaling
    const rects = [];
    for (let i = 0; i < clientRects.length; i++) {
      const r = clientRects[i];
      rects.push({
        left: (r.left - wrapperRect.left) / wrapperRect.width,
        top: (r.top - wrapperRect.top) / wrapperRect.height,
        width: r.width / wrapperRect.width,
        height: r.height / wrapperRect.height
      });
    }

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
      this.showToast('Highlighted ✓');
      sel.removeAllRanges(); // clean unselect
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

document.addEventListener('DOMContentLoaded', () => {
  window.app = new ReaderApp();
});
