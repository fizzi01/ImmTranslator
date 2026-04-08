!function() {
    let download, pdfOCR, translationPaused = !1, translationCanceled = !1, translationActive = !0, originalTextNodes = [], trTextNodes = [];
    const hasNativeUUID = "function" == typeof crypto.randomUUID;
    class ImmUtils {
        static uuidv4_fallback() {
            return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
                const r = 15 & crypto.getRandomValues(new Uint8Array(1))[0];
                return ("x" === c ? r : 3 & r | 8).toString(16);
            });
        }
        static generateUUID() {
            return hasNativeUUID ? crypto.randomUUID() : ImmUtils.uuidv4_fallback();
        }
        static pauseTranslation(notificationCallback = () => {}, feedbackCallback = () => {}) {
            translationPaused = !0, feedbackCallback("Paused", !1);
        }
        static resumeTranslation(notificationCallback = () => {}, feedbackCallback = () => {}) {
            translationPaused = !1, feedbackCallback("Resumed", !0);
        }
        static cancelTranslation(notificationCallback = () => {}, feedbackCallback = () => {}) {
            translationCanceled = !0, translationActive = !1, feedbackCallback("Canceled", !1);
        }
        static translationStatus(isActive) {
            translationActive = isActive;
        }
        static sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
        static yieldControl() {
            return new Promise(resolve => requestAnimationFrame(resolve));
        }
        static decodeHTMLEntities(text) {
            return (new DOMParser).parseFromString(text, "text/html").documentElement.textContent;
        }
        static normalize(str) {
            return str.replace(/[^\p{L}\p{N}]/gu, "");
        }
        static base64ToUint8Array(base64) {
            const raw = atob(base64), uint8Array = new Uint8Array(new ArrayBuffer(raw.length));
            for (let i = 0; i < raw.length; i++) uint8Array[i] = raw.charCodeAt(i);
            return uint8Array;
        }
        static getTextNodes(root) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode: function(node) {
                    return node.parentNode && [ "SCRIPT", "STYLE", "NOSCRIPT" ].includes(node.parentNode.tagName) ? NodeFilter.FILTER_REJECT : node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                }
            }), nodes = [];
            let currentNode;
            for (;currentNode = walker.nextNode(); ) nodes.push(currentNode);
            return nodes;
        }
        static async checkPaused() {
            for (;translationPaused && !translationCanceled; ) await ImmUtils.sleep(100);
            if (translationCanceled) throw new Error("Translation canceled.");
        }
        static isCancelled() {
            return translationCanceled;
        }
        static storeOriginalTextNodes() {
            if (originalTextNodes.length > 0) return;
            const nodes = ImmUtils.getTextNodes(document.body);
            for (const node of nodes) originalTextNodes.push({
                node: node,
                text: node.nodeValue
            });
        }
        static storeTranslationNodes() {
            trTextNodes.length > 0 && (trTextNodes = []);
            const nodes = ImmUtils.getTextNodes(document.body);
            for (const node of nodes) trTextNodes.push({
                node: node,
                text: node.nodeValue
            });
        }
        static observeCanvasResize(canvas) {
            window._canvasObservers || (window._canvasObservers = new WeakMap), window._canvasObservers.has(canvas) && window._canvasObservers.get(canvas).disconnect(), 
            canvas._observerPaused = !1;
            const resizeObserver = new ResizeObserver(() => {
                canvas._observerPaused || OCRStrategy.updateOverlay(canvas);
            });
            resizeObserver.observe(canvas), window._canvasObservers.set(canvas, resizeObserver);
        }
        static pauseCanvasObserver(canvas) {
            return canvas._observerPaused = !0, !(!window._canvasObservers || !window._canvasObservers.has(canvas)) && (window._canvasObservers.get(canvas).disconnect(), 
            !0);
        }
        static resumeCanvasObserver(canvas) {
            if (window._canvasObservers && window._canvasObservers.has(canvas)) {
                return window._canvasObservers.get(canvas).observe(canvas), setTimeout(() => {
                    canvas._observerPaused = !1;
                }, 50), !0;
            }
            return !1;
        }
        static resetTranslation(notificationCallback = () => {}, feedbackCallback = () => {}) {
            if (translationActive) {
                pdfOCR || ImmUtils.storeTranslationNodes();
                for (const entry of originalTextNodes) entry.node.nodeValue = entry.text;
                document.querySelectorAll(".ocr-box").forEach(box => {
                    box.style.display = "none";
                }), notificationCallback("Translation Reset", "success"), translationActive = !1;
            } else {
                for (const entry of trTextNodes) entry.text && (entry.node.nodeValue = entry.text);
                document.querySelectorAll(".ocr-box").forEach(box => {
                    box.style.display = "flex", OCRStrategy.adjustFontSize(box);
                }), notificationCallback("Translation Restored", "success"), translationActive = !0;
            }
        }
    }
    class Command {
        execute(options) {
            throw new Error("Metodo execute() non implementato.");
        }
    }
    class ExportPdfCommand extends Command {
        constructor(pdfExporter) {
            super(), this.pdfExporter = pdfExporter;
        }
        async execute(options, logFunction) {
            try {
                await this.pdfExporter.export(options, logFunction);
            } catch (error) {
                throw error;
            }
        }
    }
    class ProcessPdfPageCommand extends Command {
        constructor() {
            super();
        }
        async execute(pdfDoc, pageNum) {
            try {
                return await ProcessPdfPageFacede.processPage(pdfDoc, pageNum);
            } catch (error) {
                throw error;
            }
        }
    }
    class ExportImageCommand extends Command {
        constructor(imageExporter) {
            super(), this.imageExporter = imageExporter;
        }
        async execute(options, logFunction) {
            try {
                await this.imageExporter.export(options, logFunction);
            } catch (error) {
                throw error;
            }
        }
    }
    class PdfExporterFacade {
        static async processVerticalBox(box) {
            const clone = box.cloneNode(!0), offscreen = document.createElement("div");
            offscreen.className = "immTransl-offscreen", document.body.appendChild(offscreen), offscreen.appendChild(clone);
            const rect = box.getBoundingClientRect();
            clone.style.writingMode = "horizontal-tb", clone.style.transform = "none", clone.style.width = rect.height + "px", 
            clone.style.height = rect.width + "px", await new Promise(resolve => requestAnimationFrame(resolve));
            const dataUrl = (await snapdom.toPng(clone, {scale: 2, backgroundColor: "transparent"})).src;
            return offscreen.remove(), {
                dataUrl: dataUrl,
                cloneWidth: rect.height,
                cloneHeight: rect.width
            };
        }
        async export(options, logFunction) {
            try {
                const containers = document.querySelectorAll(".ocr-container");
                if (0 === containers.length) return;
                const pdfContainer = document.getElementById("pdf-container");
                const currentZoomWidth = pdfContainer ? pdfContainer.style.width : "100%";
                let firstCanvas = containers[0].querySelector("canvas[data-ocr-processed='true']");
                firstCanvas || (firstCanvas = containers[0].querySelector("canvas"));
                if (!firstCanvas) throw new Error("No pages found");
                pdfContainer && (pdfContainer.style.width = firstCanvas.width + "px");
                const zoomInButton = document.getElementById("zoomIn"), zoomOutButton = document.getElementById("zoomOut");
                zoomInButton && (zoomInButton.disabled = !0), zoomOutButton && (zoomOutButton.disabled = !0),
                await ImmUtils.sleep(300);
                containers.forEach(c => {
                    c.querySelectorAll(".ocr-box").forEach(box => {
                        try { OCRStrategy.adjustFontSize(box); } catch(e) {}
                    });
                });
                await ImmUtils.sleep(100);
                const pageWidth = firstCanvas.offsetWidth, pageHeight = firstCanvas.offsetHeight, orientation = pageWidth > pageHeight ? "landscape" : "portrait", {jsPDF: jsPDF} = window.jspdf, pdf = new jsPDF({
                    orientation: orientation,
                    unit: "px",
                    format: [ pageWidth, pageHeight ],
                    compress: !0
                });
                logFunction("⏳ Processing your PDF ⏳", "success");
                let pagesToProcess = [];
                if ("all" === options.type) pagesToProcess = Array.from({
                    length: containers.length
                }, (_, i) => i); else if ("specific" === options.type) pagesToProcess = options.pages.map(p => p - 1).filter(i => i >= 0 && i < containers.length); else if ("range" === options.type) {
                    const start = options.range.start - 1, end = options.range.end - 1;
                    pagesToProcess = [];
                    for (let i = start; i <= end && i < containers.length; i++) pagesToProcess.push(i);
                }
                for (let index = 0; index < pagesToProcess.length; index++) {
                    const i = pagesToProcess[index], container = containers[i];
                    let tCanvas = container.querySelector("canvas[data-ocr-processed='true']");
                    tCanvas && OCRStrategy.updateOverlay(tCanvas), tCanvas || (tCanvas = container.querySelector("canvas"));
                    const iPageWidth = tCanvas?.offsetWidth || pageWidth, iPageHeight = tCanvas?.offsetHeight || pageHeight, iOrientation = pageWidth > pageHeight ? "landscape" : "portrait", backupStyles = [], verticalBoxes = [];
                    container.querySelectorAll(".ocr-box").forEach((box, idx) => {
                        const computed = getComputedStyle(box);
                        backupStyles[idx] = {
                            background: computed.background,
                            backgroundColor: computed.backgroundColor,
                            boxShadow: computed.boxShadow,
                            overflow: computed.overflow,
                            height: computed.height,
                            maxHeight: computed.maxHeight,
                            padding: computed.padding
                        }, box.style.boxShadow = "none !important", box.style.overflow = "visible", box.style.border = "none !important", 
                        box.style.fontFamily = computed.fontFamily, box.style.fontSize = computed.fontSize, 
                        box.style.color = computed.color, box.style.padding = computed.padding, box.style.margin = computed.margin, 
                        box.style.writingMode = computed.writingMode, box.offsetWidth, ("vertical-rl" === computed.writingMode || computed.transform && ("matrix(0, 1, -1, 0, 0, 0)" === computed.transform || "matrix(0, -1, 1, 0, 0, 0)" === computed.transform || computed.transform.includes("rotate(90") || computed.transform.includes("rotate(-90") || computed.transform.includes("rotate(270"))) && verticalBoxes.push(box);
                        const resizeHandles = box.querySelectorAll("[class^='resize-handle']");
                        for (const handle of resizeHandles) handle.style.display = "none";
                    });
                    const tempImages = [];
                    for (const box of verticalBoxes) {
                        const {dataUrl: dataUrl, cloneWidth: cloneWidth, cloneHeight: cloneHeight} = await PdfExporterFacade.processVerticalBox(box), computed = getComputedStyle(box), left = parseFloat(computed.left) + cloneHeight, top = parseFloat(computed.top), img = new Image;
                        img.src = dataUrl, img.style.position = "absolute", img.style.width = cloneWidth + "px", 
                        img.style.height = cloneHeight + "px", img.setAttribute("width", 2 * cloneWidth), 
                        img.setAttribute("height", 2 * cloneHeight), img.style.left = left + "px", img.style.top = top + "px", 
                        "vertical-rl" === box.style.writingMode ? (img.style.transform = "rotate(90deg)", 
                        img.style.transformOrigin = "top left") : (img.style.left = left - cloneHeight + "px", 
                        img.style.transform = box.style.transform, img.style.transformOrigin = "bottom left"), 
                        img.style.zIndex = "1000", container.appendChild(img), tempImages.push({
                            box: box,
                            img: img
                        }), box.style.display = "none";
                    }
                    logFunction(`Preparing page ${i + 1}`, "warning");
                    let originalCanvas = container.querySelector("canvas[data-ocr-processed='true']");
                    originalCanvas || (originalCanvas = container.querySelector("canvas"));
                    if (!originalCanvas) {
                        for (const {box: box, img: img} of tempImages) box.style.display = "", img.remove();
                        continue;
                    }
                    let imgData;
                    const hasOcrBoxes = container.querySelectorAll(".ocr-box").length > 0;
                    if (!hasOcrBoxes) {
                        imgData = originalCanvas.toDataURL("image/jpeg", options.quality);
                    } else {
                        const bgImg = new Image;
                        bgImg.src = originalCanvas.toDataURL("image/png"), bgImg.style.width = iPageWidth + "px",
                        bgImg.style.height = iPageHeight + "px", bgImg.setAttribute("width", iPageWidth),
                        bgImg.setAttribute("height", iPageHeight), bgImg.style.position = "absolute", bgImg.style.top = "0",
                        bgImg.style.left = "0", bgImg.style.zIndex = "999", bgImg.style.display = "block",
                        container.insertBefore(bgImg, container.firstChild);
                        imgData = (await snapdom.toJpg(container, {quality: options.quality})).src;
                        bgImg.remove();
                    }
                    container.querySelectorAll(".ocr-box").forEach((box, idx) => {
                        const backup = backupStyles[idx];
                        if (!backup) return;
                        box.style.background = backup.background, box.style.backgroundColor = backup.backgroundColor, 
                        box.style.boxShadow = backup.boxShadow, box.style.overflow = backup.overflow, box.style.height = backup.height, 
                        box.style.maxHeight = backup.maxHeight, box.style.padding = backup.padding;
                        const resizeHandles = box.querySelectorAll("[class^='resize-handle']");
                        for (const handle of resizeHandles) handle.style.display = "";
                    });
                    for (const {box: box, img: img} of tempImages) box.style.display = "", img.remove();
                    index > 0 && (pdf.addPage([ iPageWidth, iPageHeight ], iOrientation), pdf.internal.pageSize.width = iPageWidth, 
                    pdf.internal.pageSize.height = iPageHeight, pdf.internal.pageSize.orientation = iOrientation), 
                    pdf.addImage(imgData, "JPEG", 0, 0, iPageWidth, iPageHeight), await new Promise(resolve => setTimeout(resolve, 50));
                }
                pdfContainer && (pdfContainer.style.width = currentZoomWidth);
                await ImmUtils.sleep(100);
                containers.forEach(c => {
                    c.querySelectorAll(".ocr-box").forEach(box => {
                        try { OCRStrategy.adjustFontSize(box); } catch(e) {}
                    });
                });
                zoomInButton && (zoomInButton.disabled = !1),
                zoomOutButton && (zoomOutButton.disabled = !1), logFunction("PDF Ready ✅", "success");
                const name = fileName || "PDF";
                pdf.save(`${name}_translated.pdf`);
            } catch (error) {
                throw error;
            }
        }
    }
    class ProcessPdfPageFacede {
        static async createPlaceholder(pdfDoc, pageNum) {
            const page = await pdfDoc.getPage(pageNum);
            const scale = Math.max(window.devicePixelRatio || 1, 2);
            const viewport = page.getViewport({ scale: scale, dontFlip: !1 });
            const pageContainer = document.createElement("div");
            pageContainer.classList.add("ocr-container", "ocr-placeholder"),
            pageContainer.style.aspectRatio = viewport.width + " / " + viewport.height,
            pageContainer.dataset.pageNum = pageNum,
            pageContainer.dataset.pageState = "placeholder";
            return document.getElementById("pdf-container").appendChild(pageContainer), pageContainer;
        }
        static async renderPage(pdfDoc, pageNum, container) {
            if ("placeholder" !== container.dataset.pageState) return container;
            container.dataset.pageState = "rendering";
            const page = await pdfDoc.getPage(pageNum);
            const scale = Math.max(window.devicePixelRatio || 1, 2);
            const viewport = page.getViewport({ scale: scale, dontFlip: !1 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width, canvas.height = viewport.height,
            canvas.crossOrigin = "anonymous";
            const context = canvas.getContext("2d");
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            const textPage = await page.getTextContent();
            textPage.items.length > 0 && (canvas.pdfTextContent = { text: textPage, viewport: viewport });
            container.classList.remove("ocr-placeholder"), container.appendChild(canvas),
            container.dataset.pageState = "rendered";
            return container;
        }
        static async processPage(pdfDoc, pageNum) {
            const page = await pdfDoc.getPage(pageNum);
            const scale = Math.max(window.devicePixelRatio || 1, 2);
            const viewport = page.getViewport({ scale: scale, dontFlip: !1 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width, canvas.height = viewport.height,
            canvas.crossOrigin = "anonymous";
            const context = canvas.getContext("2d"), pageContainer = document.createElement("div");
            pageContainer.classList.add("ocr-container", "ocr-placeholder"), await page.render({
                canvasContext: context, viewport: viewport
            }).promise;
            const textPage = await page.getTextContent();
            textPage.items.length > 0 && (canvas.pdfTextContent = { text: textPage, viewport: viewport });
            pageContainer.appendChild(canvas);
            return document.getElementById("pdf-container").appendChild(pageContainer), pageContainer;
        }
    }
    class ImageExporterFacade {
        static restoreImageOverlay() {
            try {
                const container = document.getElementById("imageContainer"), overlayImg = document.getElementById("overlayCanvasImage");
                overlayImg && overlayImg.remove(), container.querySelectorAll(".ocr-box").forEach(box => {
                    box.style.display = "";
                });
                const pdfButton = document.getElementById("downloadPdf");
                pdfButton && (pdfButton.disabled = !1);
            } catch (err) {}
        }
        static async processVerticalBox(box) {
            const clone = box.cloneNode(!0), offscreen = document.createElement("div");
            offscreen.className = "immTransl-offscreen", document.body.appendChild(offscreen), offscreen.appendChild(clone);
            const rect = box.getBoundingClientRect();
            clone.style.writingMode = "horizontal-tb", clone.style.transform = "none", clone.style.width = rect.height + "px", 
            clone.style.height = rect.width + "px", await new Promise(resolve => requestAnimationFrame(resolve));
            const dataUrl = (await snapdom.toPng(clone, {scale: 2, backgroundColor: "transparent"})).src;
            return offscreen.remove(), {
                dataUrl: dataUrl,
                cloneWidth: rect.height,
                cloneHeight: rect.width
            };
        }
        async export(options, logFunction) {
            try {
                const container = document.querySelectorAll(".ocr-container")[1], backupOverflow = container.style.overflow, backupHeight = container.style.height, backupBackground = container.style.background;
                container.style.overflow = "visible", container.style.height = "auto";
                const base64Image = document.getElementById("base64Image");
                if (!base64Image) return void logFunction("No image found", "error");
                const rect = base64Image.getBoundingClientRect();
                let pageWidth = rect.width, pageHeight = rect.height;
                container.style.width = pageWidth + "px", container.style.height = pageHeight + "px", 
                logFunction("Preparing image ...", "warning");
                const verticalBoxes = [];
                container.querySelectorAll(".ocr-box").forEach(box => {
                    const computed = getComputedStyle(box);
                    box.style.background = computed.background, box.style.backgroundColor = computed.backgroundColor, 
                    box.style.border = computed.border, box.style.fontFamily = computed.fontFamily, 
                    box.style.fontSize = computed.fontSize, box.style.color = computed.color, box.style.padding = computed.padding, 
                    box.style.margin = computed.margin, box.style.boxShadow = computed.boxShadow, "vertical-rl" === computed.writingMode && verticalBoxes.push(box);
                });
                const tempImages = [];
                for (const box of verticalBoxes) {
                    const {dataUrl: dataUrl, cloneWidth: cloneWidth, cloneHeight: cloneHeight} = await ImageExporterFacade.processVerticalBox(box), computed = getComputedStyle(box), left = parseFloat(computed.left) + cloneHeight, top = parseFloat(computed.top), img = new Image;
                    img.src = dataUrl, img.style.position = "absolute", img.style.width = cloneWidth + "px", 
                    img.style.height = cloneHeight + "px", img.style.left = left + "px", img.style.top = top + "px", 
                    img.style.transform = "rotate(90deg)", img.style.transformOrigin = "top left", img.style.zIndex = "1000", 
                    container.appendChild(img), tempImages.push({
                        box: box,
                        img: img
                    }), box.style.display = "none";
                }
                const imageUri = base64Image.src, viewportScale = window.visualViewport ? window.visualViewport.scale : 1, bgImg = new Image;
                1 !== viewportScale && (bgImg.src = imageUri, bgImg.style.width = pageWidth + "px", 
                bgImg.style.height = pageHeight + "px", bgImg.style.width = "100%", bgImg.style.height = "100%", 
                bgImg.setAttribute("width", pageWidth), bgImg.setAttribute("height", pageHeight), 
                bgImg.style.position = "absolute", bgImg.style.top = "0", bgImg.style.left = "0", 
                bgImg.style.zIndex = "999", bgImg.style.display = "block", container.insertBefore(bgImg, container.firstChild));
                const imgData = (await snapdom.toPng(container, {quality: options.quality})).src;
                1 !== viewportScale && bgImg?.remove();
                for (const {box: box, img: img} of tempImages) box.style.display = "", img.remove();
                if (container.style.overflow = backupOverflow, container.style.height = backupHeight, 
                container.style.background = backupBackground, download) {
                    logFunction("Image Ready ✅", "success");
                    const link = document.createElement("a");
                    link.href = imgData, link.download = `${fileName}_translated.png`, link.addEventListener("error", () => {
                        logFunction("Download canceled", "warning");
                    }), document.body.appendChild(link), link.click(), document.body.removeChild(link);
                } else {
                    let overlayImg = document.getElementById("overlayCanvasImage");
                    overlayImg || (overlayImg = document.createElement("img"), overlayImg.id = "overlayCanvasImage", 
                    overlayImg.style.position = "absolute", overlayImg.style.top = "0", overlayImg.style.left = "0", 
                    overlayImg.style.width = "100%", overlayImg.style.height = "auto", overlayImg.style.zIndex = "9998", 
                    container.appendChild(overlayImg)), overlayImg.src = imgData, overlayImg.style.display = "block", 
                    container.querySelectorAll(".ocr-box").forEach(box => {
                        box.style.display = "none";
                    });
                    const button = document.getElementById("downloadPdf");
                    button && (button.disabled = !0);
                    const headerButtons = document.querySelector(".headerButtons");
                    if (headerButtons) {
                        const existingEditBtn = document.getElementById("editTranslationButton");
                        existingEditBtn && existingEditBtn.remove();
                        const editBtn = document.createElement("button");
                        editBtn.id = "editTranslationButton", editBtn.className = "modernButton", editBtn.textContent = "Edit translation", 
                        editBtn.onclick = function() {
                            ImageExporterFacade.restoreImageOverlay(), editBtn.remove();
                        }, headerButtons.appendChild(editBtn);
                    }
                    logFunction("Image Ready ✅", "success", 4e3), logFunction("Hold the image to download it!", "info", 1e4);
                }
            } catch (error) {}
        }
    }
    class TranslationService {
        constructor(translator, type, queueDelay = 1e3, worker) {
            this.translator = translator, this.worker = worker, this.pendingWorkerRequests = {}, 
            this.queueDelay = queueDelay, this.type = type;
        }
        initWorker() {
            this.worker.postMessage({
                action: "init",
                config: {
                    apiKey: this.translator?.apiKey,
                    openAiUrl: this.translator?.openAiUrl,
                    model: this.translator?.model,
                    temperature: this.translator?.temperature,
                    targetLang: this.translator?.targetLang,
                    prompt: this.translator?.prompt,
                    type: this.type,
                    callDelay: this.queueDelay
                }
            }), this.worker.addEventListener("message", e => {
                e.data.type;
                const data = e.data;
                data.requestId && this.pendingWorkerRequests[data.requestId] && ("success" === data.status ? this.pendingWorkerRequests[data.requestId].resolve(data.translation) : this.pendingWorkerRequests[data.requestId].reject(new Error(data.error)), 
                delete this.pendingWorkerRequests[data.requestId]);
            });
        }
        stopWorker() {
            this.worker.terminate(), this.worker = null, this.pendingWorkerRequests = {};
        }
        async translateText(text) {
            return new Promise((resolve, reject) => {
                const requestId = "req_" + ImmUtils.generateUUID();
                this.pendingWorkerRequests[requestId] = {
                    resolve: resolve,
                    reject: reject
                }, this.worker.postMessage({
                    action: "translateText",
                    text: text,
                    requestId: requestId
                });
            });
        }
        async translateBatch(batchPayload) {
            return new Promise((resolve, reject) => {
                const requestId = "batch_" + ImmUtils.generateUUID();
                this.pendingWorkerRequests[requestId] = {
                    resolve: resolve,
                    reject: reject
                }, this.worker.postMessage({
                    action: "translateBatch",
                    batchPayload: batchPayload,
                    requestId: requestId
                });
            });
        }
    }
    class NotificationManager {
        constructor() {
            return this.container = null, NotificationManager.instance || (this.container = this._createContainer(), 
            this.maxNotifications = 3, NotificationManager.instance = this), NotificationManager.instance;
        }
        setMaxNotifications(max) {
            this.maxNotifications = max;
        }
        _createContainer() {
            let container = document.getElementById("notificationContainer");
            if (!container) {
                const mainUIContainer = document.getElementById("immersiveTranslatorUI");
                if (mainUIContainer) {
                    container = document.createElement("div"), container.id = "notificationContainer";
                    const translationContainer = document.getElementById("translationContainer");
                    translationContainer ? mainUIContainer.insertBefore(container, translationContainer) : mainUIContainer.appendChild(container);
                } else container = document.createElement("div"), container.id = "notificationContainer", 
                document.body.appendChild(container);
            }
            return container;
        }
        showNotification(message, severity = "error", duration = 2e3) {
            const notification = document.createElement("div");
            for (this.container || (this.container = this._createContainer()); this.container.children.length >= this.maxNotifications; ) this.container.removeChild(this.container.firstChild);
            notification.className = `notification ${severity}`, notification.textContent = message, 
            this.container.appendChild(notification), setTimeout(() => {
                notification.classList.add("fade-out"), notification.addEventListener("animationend", () => notification.remove());
            }, duration);
        }
    }
    class BaseUIManager {
        constructor() {
            this.notificationManager = new NotificationManager, this.created = !1, this.removed = !1;
        }
        addCSS() {
            const style = document.createElement("style");
            style.textContent = '\n#translationContainer,#translationFeedbackBox{display:flex!important;transform-origin:right center!important}#translationFeedbackBox,.notification{font-weight:var(--md-font-weight-regular)!important;letter-spacing:.2px!important;word-wrap:break-word!important}#translationFeedbackBox,.notification,.ocr-box{word-wrap:break-word!important}#pdf-container.dragging,.ocr-box.dragging{touch-action:none;-webkit-touch-callout:none}:root{--md-primary-50:#e8f6f9;--md-primary-100:#c6e9f0;--md-primary-200:#9fdae6;--md-primary-300:#76c8db;--md-primary-400:#58bbd4;--md-primary-500:#3aaecd;--md-primary-600:#349bc3;--md-primary-700:#2d85b5;--md-primary-800:#2770a7;--md-primary-900:#1c4e8f;--md-secondary-50:#fdf2f0;--md-secondary-100:#faddd7;--md-secondary-200:#f7c5bb;--md-secondary-300:#f3ac9f;--md-secondary-400:#f0988a;--md-secondary-500:#ed8575;--md-secondary-600:#eb7d6d;--md-secondary-700:#e87262;--md-secondary-800:#e56858;--md-secondary-900:#e05645;--md-surface-50:#f8fafb;--md-surface-100:#f1f5f7;--md-surface-200:#e8eff2;--md-surface-300:#d8e3e8;--md-surface-400:#b8c9d1;--md-surface-500:#94a8b3;--md-surface-600:#718590;--md-surface-700:#5a6b75;--md-surface-800:#42505a;--md-surface-900:#2a3439;--md-success-50:#f0faf4;--md-success-100:#dcf4e6;--md-success-500:#22c55e;--md-success-700:#15803d;--md-warning-50:#fffbeb;--md-warning-100:#fef3c7;--md-warning-500:#f59e0b;--md-warning-700:#d97706;--md-error-50:#fef2f2;--md-error-100:#fee2e2;--md-error-500:#ef4444;--md-error-700:#dc2626;--md-shadow-1:0px 2px 1px -1px rgba(0,0,0,0.2),0px 1px 1px 0px rgba(0,0,0,0.14),0px 1px 3px 0px rgba(0,0,0,0.12);--md-shadow-2:0px 3px 1px -2px rgba(0,0,0,0.2),0px 2px 2px 0px rgba(0,0,0,0.14),0px 1px 5px 0px rgba(0,0,0,0.12);--md-shadow-3:0px 3px 3px -2px rgba(0,0,0,0.2),0px 3px 4px 0px rgba(0,0,0,0.14),0px 1px 8px 0px rgba(0,0,0,0.12);--md-shadow-4:0px 2px 4px -1px rgba(0,0,0,0.2),0px 4px 5px 0px rgba(0,0,0,0.14),0px 1px 10px 0px rgba(0,0,0,0.12);--md-shadow-6:0px 3px 5px -1px rgba(0,0,0,0.2),0px 6px 10px 0px rgba(0,0,0,0.14),0px 1px 18px 0px rgba(0,0,0,0.12);--md-shadow-8:0px 5px 5px -3px rgba(0,0,0,0.2),0px 8px 10px 1px rgba(0,0,0,0.14),0px 3px 14px 2px rgba(0,0,0,0.12);--md-shadow-12:0px 7px 8px -4px rgba(0,0,0,0.2),0px 12px 17px 2px rgba(0,0,0,0.14),0px 5px 22px 4px rgba(0,0,0,0.12);--md-font-family:"Roboto",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--md-font-weight-light:300;--md-font-weight-regular:400;--md-font-weight-medium:500;--md-font-weight-bold:700;--md-border-radius-small:4px;--md-border-radius-medium:8px;--md-border-radius-large:12px;--md-border-radius-extra-large:16px;--md-transition-duration-short:150ms;--md-transition-duration-medium:250ms;--md-transition-duration-long:300ms;--md-transition-easing-standard:cubic-bezier(0.4, 0.0, 0.2, 1);--md-transition-easing-decelerate:cubic-bezier(0.0, 0.0, 0.2, 1);--md-transition-easing-accelerate:cubic-bezier(0.4, 0.0, 1, 1)}@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}@keyframes immTransl-slideUp{from{opacity:0;transform:translateY(20px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes immTransl-fadeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}@keyframes immTransl-fadeOut{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.96) translateY(8px)}}@keyframes md-fadein{from{opacity:0!important;transform:translateY(-8px) scale(.95)}to{opacity:1!important;transform:translateY(0) scale(1)}}@keyframes md-fadeout{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.95)}}@keyframes md-slide-up{from{opacity:0;transform:translateY(16px) scale(.95)}to{opacity:1;transform:translateY(0) scale(1)}}#immersiveTranslatorUI{position:fixed!important;bottom:24px!important;right:24px!important;z-index:10000000!important;display:flex!important;flex-direction:column!important;align-items:flex-end!important;gap:12px!important;pointer-events:none!important;font-family:var(--md-font-family)!important}#translationFeedbackBox,.immTransl-control-btn{font-family:var(--md-font-family)!important;position:relative!important}#immersiveTranslatorUI>*,#notificationContainer>*{pointer-events:auto!important}#translationContainer{flex-direction:row!important;align-items:center!important;gap:10px!important;transition:transform .4s cubic-bezier(.16, 1, .3, 1),opacity .3s,gap .3s!important;font-family:var(--md-font-family)!important;animation:.5s cubic-bezier(.16,1,.3,1) immTransl-slideUp!important}#translationContainer.hidden{gap:0!important}#translationContainer.hidden #resetButton{width:0!important;height:0!important;min-width:0!important;min-height:0!important;padding:0!important;margin:0!important;opacity:0!important;overflow:hidden!important;pointer-events:none!important;border:none!important;box-shadow:none!important}#translationContainer.hidden #translationFeedbackBox{padding:6px 6px 6px 10px!important;border-radius:24px!important;min-height:36px!important}#translationContainer.hidden #feedbackText,#translationContainer.hidden #translationControls{width:0!important;max-width:0!important;margin:0!important;padding:0!important;pointer-events:none!important;min-width:0!important;overflow:hidden!important;opacity:0!important}#translationContainer.hidden #translationFeedbackBox::before{opacity:0!important}#translationContainer.hidden #feedbackText{flex:0 0 0px!important}#translationContainer.hidden #translationControls{flex:0 0 0px!important;border-color:transparent!important}#translationContainer.hidden .immTransl-arrow{transform:rotate(180deg);margin-right:0;border-radius:22px!important}#translationContainer.hidden .spinner{margin-right:4px!important;margin-left:10px!important}#translationFeedbackBox{background:rgba(12,17,29,.82)!important;color:rgba(255,255,255,.92)!important;padding:12px 18px!important;border-radius:14px!important;font-size:13.5px!important;align-items:center!important;gap:0!important;box-shadow:0 8px 32px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.15),inset 0 1px 0 rgba(255,255,255,.06)!important;backdrop-filter:blur(24px) saturate(1.4)!important;-webkit-backdrop-filter:blur(24px) saturate(1.4)!important;border:1px solid rgba(255,255,255,.08)!important;transition:transform .3s cubic-bezier(.16, 1, .3, 1),box-shadow .3s,padding .3s cubic-bezier(.16, 1, .3, 1),border-radius .3s,min-height .3s,background .4s,color .4s,border-color .4s!important;min-height:48px!important;max-width:90vw!important;overflow:hidden!important;overflow-wrap:break-word!important}#translationFeedbackBox::before{content:""!important;position:absolute!important;top:0!important;left:16px!important;right:16px!important;height:2px!important;background:linear-gradient(90deg,var(--md-primary-400),var(--md-primary-300),var(--md-primary-500))!important;border-radius:0 0 2px 2px!important;opacity:.7!important}.immTransl-arrow{width:18px;height:18px;cursor:pointer;transition:transform .3s cubic-bezier(.16, 1, .3, 1),background .2s,margin .3s,color .4s;margin-right:10px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.5);border-radius:8px;padding:8px;background:rgba(255,255,255,.04);min-width:34px;min-height:34px;flex-shrink:0;touch-action:manipulation}.immTransl-arrow:hover{background:rgba(255,255,255,.1);color:rgba(255,255,255,.85)}.immTransl-arrow:active{background:rgba(255,255,255,.14);transform:scale(.92)}.immTransl-arrow svg{width:16px!important;height:16px!important}#translationFeedbackBox .spinner{width:24px!important;height:24px!important;border:2.5px solid rgba(118,200,219,.2)!important;border-top-color:var(--md-primary-300)!important;border-radius:50%!important;margin-right:12px!important;animation:.8s cubic-bezier(.45,.05,.55,.95) infinite spin!important;flex-shrink:0!important;transition:margin .3s,border-color .4s!important}#feedbackText{flex:1 1 auto!important;min-width:0!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;font-size:13.5px!important;color:rgba(255,255,255,.85)!important;letter-spacing:.15px!important;line-height:1.4!important;max-width:500px!important;transition:max-width 350ms cubic-bezier(.16, 1, .3, 1),opacity 250ms,color .4s!important}#notificationContainer{display:flex!important;flex-direction:column!important;gap:8px!important;max-width:90vw!important;font-family:var(--md-font-family)!important}.notification{padding:14px 20px!important;border-radius:12px!important;color:var(--md-surface-50)!important;font-family:var(--md-font-family)!important;font-size:13px!important;box-shadow:0 8px 24px rgba(0,0,0,.2),0 2px 6px rgba(0,0,0,.1)!important;animation:.4s cubic-bezier(.16,1,.3,1) immTransl-slideUp!important;backdrop-filter:blur(16px)!important;-webkit-backdrop-filter:blur(16px)!important;overflow-wrap:break-word!important;line-height:1.45!important;max-width:100%!important;border:1px solid rgba(255,255,255,.06)!important}.immTransl-control-btn,.notification.warning{color:var(--md-surface-50)!important;font-weight:var(--md-font-weight-medium)!important}.notification.error{background:rgba(220,38,38,.88)!important;color:var(--md-surface-50)!important}.notification.warning{background:rgba(217,119,6,.88)!important}.notification.success{background:rgba(21,128,61,.88)!important;color:var(--md-surface-50)!important}.notification.info{background:rgba(45,133,181,.88)!important;color:var(--md-surface-50)!important}.fade-out{animation:250ms cubic-bezier(.4,0,1,1) forwards immTransl-fadeOut!important}.ocr-box .spinner,.text-spinner{animation:1s linear infinite spin}#immersiveTranslatorUI.immTransl-light #translationFeedbackBox{background:rgba(255,255,255,.9)!important;color:rgba(0,0,0,.82)!important;border-color:rgba(0,0,0,.07)!important;box-shadow:0 8px 32px rgba(0,0,0,.1),0 2px 8px rgba(0,0,0,.06),inset 0 1px 0 rgba(255,255,255,.6)!important}#immersiveTranslatorUI.immTransl-light #translationFeedbackBox::before{background:linear-gradient(90deg,var(--md-primary-500),var(--md-primary-400),var(--md-primary-600))!important;opacity:.85!important}#immersiveTranslatorUI.immTransl-light .immTransl-arrow{color:rgba(0,0,0,.35);background:rgba(0,0,0,.04)}#immersiveTranslatorUI.immTransl-light .immTransl-arrow:hover{background:rgba(0,0,0,.08);color:rgba(0,0,0,.65)}#immersiveTranslatorUI.immTransl-light .immTransl-arrow:active{background:rgba(0,0,0,.12)}#immersiveTranslatorUI.immTransl-light .immTransl-arrow svg g,#immersiveTranslatorUI.immTransl-light .immTransl-control-btn.cancel svg g,#immersiveTranslatorUI.immTransl-light .immTransl-control-btn.pause svg g,#immersiveTranslatorUI.immTransl-light .immTransl-control-btn.resume svg g{fill:currentColor!important}#immersiveTranslatorUI.immTransl-light #translationFeedbackBox .spinner{border-color:rgba(58,174,205,.25)!important;border-top-color:var(--md-primary-600)!important}#immersiveTranslatorUI.immTransl-light #feedbackText{color:rgba(0,0,0,.7)!important}#immersiveTranslatorUI.immTransl-light #translationControls{border-left-color:rgba(0,0,0,.08)!important}#immersiveTranslatorUI.immTransl-light .immTransl-control-btn.pause{background:rgba(245,158,11,.1)!important;color:#b45309!important}#immersiveTranslatorUI.immTransl-light .immTransl-control-btn.pause:hover{background:rgba(245,158,11,.18)!important}#immersiveTranslatorUI.immTransl-light .immTransl-control-btn.resume{background:rgba(34,197,94,.1)!important;color:#15803d!important}#immersiveTranslatorUI.immTransl-light .immTransl-control-btn.resume:hover{background:rgba(34,197,94,.18)!important}#immersiveTranslatorUI.immTransl-light .immTransl-control-btn.cancel{background:rgba(239,68,68,.1)!important;color:#dc2626!important}#immersiveTranslatorUI.immTransl-light .immTransl-control-btn.cancel:hover{background:rgba(239,68,68,.18)!important}#immersiveTranslatorUI.immTransl-light .notification{border-color:rgba(0,0,0,.06)!important}#translationControls{margin-left:12px!important;display:flex!important;gap:6px!important;align-items:center!important;flex-shrink:0!important;padding-left:12px!important;border-left:1px solid rgba(255,255,255,.08)!important;max-width:300px!important;transition:max-width 350ms cubic-bezier(.16, 1, .3, 1),opacity 250ms,margin .3s,padding .3s,border-color .3s!important}.immTransl-control-btn{width:34px!important;height:34px!important;border:none!important;border-radius:10px!important;cursor:pointer!important;outline:0!important;display:flex!important;align-items:center!important;justify-content:center!important;font-size:14px!important;transition:.2s cubic-bezier(.16, 1, .3, 1)!important;box-shadow:none!important;overflow:hidden!important;touch-action:manipulation!important;min-width:34px!important;min-height:34px!important;flex-shrink:0!important}#pdf-toolbar,#pdf-toolbar button,#pdf-toolbar span,.text-retry-button{font-weight:var(--md-font-weight-medium);color:var(--md-surface-50)}.text-retry-button,.translation-wrapper{position:relative;font-family:var(--md-font-family)}.immTransl-control-btn svg{width:10px!important;height:10px!important}.immTransl-control-btn::before{content:"";position:absolute;top:0;left:0;right:0;bottom:0;background:currentColor;opacity:0;transition:opacity 150ms;border-radius:inherit}.immTransl-control-btn:hover{transform:scale(1.08)!important;box-shadow:0 4px 12px rgba(0,0,0,.25)!important}.immTransl-control-btn:hover::before{opacity:.1}.immTransl-control-btn:active{transform:scale(.95)!important;box-shadow:none!important}.immTransl-control-btn:active::before{opacity:.15}.immTransl-control-btn.pause{background:rgba(245,158,11,.18)!important;color:#fbbf24!important}.immTransl-control-btn.pause:hover{background:rgba(245,158,11,.3)!important}.immTransl-control-btn.resume{background:rgba(34,197,94,.18)!important;color:#4ade80!important}.immTransl-control-btn.resume:hover{background:rgba(34,197,94,.3)!important}.immTransl-control-btn.cancel{background:rgba(239,68,68,.18)!important;color:#f87171!important}.immTransl-control-btn.cancel:hover{background:rgba(239,68,68,.3)!important}.immTransl-control-btn.reset{background:linear-gradient(135deg,var(--md-primary-400),var(--md-primary-600))!important;color:var(--md-surface-50)!important;width:44px!important;height:44px!important;min-width:44px!important;min-height:44px!important;border-radius:13px!important;box-shadow:0 4px 16px rgba(118,200,219,.25),0 2px 6px rgba(0,0,0,.15)!important;transition:.3s cubic-bezier(.16, 1, .3, 1)!important}.immTransl-control-btn.reset svg{width:18px!important;height:18px!important}.immTransl-control-btn.reset:hover{box-shadow:0 6px 24px rgba(118,200,219,.35),0 2px 8px rgba(0,0,0,.2)!important;transform:scale(1.06)!important}.immTransl-control-btn:disabled,.immTransl-control-btn:disabled:hover{transform:none!important;box-shadow:none!important}.immTransl-control-btn:disabled{opacity:.3!important;cursor:not-allowed!important}#pdfOptionsModal button#confirmPdfOptions:hover,.text-retry-button:hover{box-shadow:var(--md-shadow-4);transform:translateY(-1px)}#pdf-toolbar button:disabled::before,.immTransl-control-btn:disabled::before{display:none}.translation-wrapper{align-items:center}.text-spinner{display:inline-block;width:16px;height:16px;border:2px solid var(--md-surface-400);border-top:2px solid var(--md-primary-500);border-radius:50%;margin-left:8px;flex:0 0 auto}.text-retry-button{width:20px;height:20px;background-color:var(--md-error-500);border:none;border-radius:var(--md-border-radius-small);padding:4px;display:inline-flex;align-items:center;justify-content:center;text-transform:uppercase;cursor:pointer;outline:0;box-shadow:var(--md-shadow-2);transition:all var(--md-transition-duration-short) var(--md-transition-easing-standard);z-index:1000;overflow:hidden;touch-action:manipulation;min-width:28px;min-height:28px}.ocr-box .spinner,.ocr-container-inline{display:inline-block}.ocr-box,.ocr-overlay{font-family:"Helvetica Neue",Arial,sans-serif!important;z-index:9999!important}#pdf-toolbar button::before,#pdfOptionsModal button::before,.text-retry-button::before{content:"";position:absolute;top:0;left:0;right:0;bottom:0;background:currentColor;opacity:0;transition:opacity var(--md-transition-duration-short) var(--md-transition-easing-standard);border-radius:inherit}#pdf-toolbar button,#pdfOptionsModal button,#pdfOptionsModal input[type=radio]{transition:all var(--md-transition-duration-short) var(--md-transition-easing-standard)}#pdfOptionsModal button#confirmPdfOptions:active,.text-retry-button:active{transform:translateY(0);box-shadow:var(--md-shadow-1)}#pdf-toolbar button:focus::before,#pdfOptionsModal button:hover::before,.text-retry-button:hover::before{opacity:.08}#pdfOptionsModal button:active::before,.text-retry-button:active::before{opacity:.16}.text-retry-button::after{position:absolute;top:0;left:0;right:0;bottom:0;background:0 0;z-index:9999}@media (max-width:768px){#notificationContainer,#translationContainer{max-width:calc(100vw - 32px)!important}.immTransl-arrow,.immTransl-control-btn,.immTransl-control-btn.reset,.text-retry-button,button{min-width:44px!important;min-height:44px!important}#immersiveTranslatorUI{bottom:16px!important;right:16px!important}#translationContainer{gap:8px!important;padding:0!important}#translationFeedbackBox{padding:11px 14px!important;font-size:13px!important;border-radius:12px!important;min-height:44px!important;max-width:calc(100vw - 100px)!important}#translationFeedbackBox::before{left:12px!important;right:12px!important}.immTransl-arrow{padding:11px;margin-right:8px}#translationFeedbackBox .spinner{width:16px!important;height:16px!important;margin-right:10px!important}#feedbackText{font-size:13px!important;max-width:300px!important}#translationControls{margin-left:10px!important;padding-left:10px!important;gap:5px!important}#translationContainer.hidden #translationFeedbackBox{padding:5px 8px!important;min-height:34px!important}.immTransl-control-btn.reset{width:42px!important;height:42px!important}.notification{padding:12px 16px!important;font-size:12.5px!important;border-radius:10px!important}.text-spinner{width:15px;height:15px;margin-left:6px;border-width:1.5px}.text-retry-button{width:24px;height:24px;padding:4px}#translationContainer.hidden #resetButton,#translationContainer.hidden .immTransl-control-btn:not(.reset){min-width:0!important;min-height:0!important}#translationFeedbackBox,.notification{-webkit-text-size-adjust:100%;text-size-adjust:100%}input[type=email],input[type=number],input[type=password],input[type=text],textarea{font-size:16px!important}}@media (max-width:480px){#notificationContainer,#translationContainer{max-width:calc(100vw - 24px)!important}#immersiveTranslatorUI{bottom:12px!important;right:12px!important}#translationContainer{gap:6px!important}#translationFeedbackBox{padding:10px 12px!important;font-size:12.5px!important;border-radius:10px!important;min-height:42px!important;max-width:calc(100vw - 80px)!important}.immTransl-arrow{padding:10px;margin-right:6px}#translationFeedbackBox .spinner{width:14px!important;height:14px!important;margin-right:8px!important;border-width:2px!important}#feedbackText{font-size:12px!important;max-width:200px!important}#translationControls{margin-left:8px!important;padding-left:8px!important;gap:4px!important}#translationContainer.hidden #translationFeedbackBox{padding:4px 7px!important;min-height:32px!important}.immTransl-control-btn{width:30px!important;height:30px!important;border-radius:8px!important}.immTransl-control-btn.reset{width:40px!important;height:40px!important;min-width:44px!important;min-height:44px!important;border-radius:11px!important}.notification{padding:10px 14px!important;font-size:12px!important;border-radius:8px!important}.text-spinner{width:14px;height:14px;margin-left:5px;border-width:1.5px}.text-retry-button{width:22px;height:22px;padding:4px}.immTransl-arrow,.immTransl-control-btn,.text-retry-button,button{min-width:40px!important;min-height:40px!important}#translationContainer.hidden #resetButton,#translationContainer.hidden .immTransl-control-btn:not(.reset){min-width:0!important;min-height:0!important}.notification{min-width:180px!important}}@media (max-width:768px) and (orientation:landscape){#immersiveTranslatorUI{bottom:8px!important}}.immTransl-offscreen{position:fixed!important;left:-9999px!important;top:-9999px!important;opacity:0!important}#translationFeedbackBox .spinner.spinner-hidden{display:none!important}.resize-handle{position:absolute;background:0 0}.resize-handle.bottom,.resize-handle.top{height:8px;width:100%;left:0;cursor:ns-resize}.resize-handle.top{top:-4px}.resize-handle.bottom{bottom:-4px}.resize-handle.left,.resize-handle.right{width:8px;height:100%;top:0;cursor:ew-resize}.resize-handle.left{left:-4px}.resize-handle.right{right:-4px}.resize-handle.bottom-left,.resize-handle.bottom-right,.resize-handle.top-left,.resize-handle.top-right{width:12px;height:12px}.resize-handle.top-left{top:-6px;left:-6px;cursor:nwse-resize}.resize-handle.top-right{top:-6px;right:-6px;cursor:nesw-resize}.resize-handle.bottom-right{bottom:-6px;right:-6px;cursor:nwse-resize}.resize-handle.bottom-left{bottom:-6px;left:-6px;cursor:nesw-resize}.ocr-container{position:relative}.PDFtextLayer span,.ocr-box,.ocr-overlay{position:absolute!important}.ocr-container canvas{z-index:1}.ocr-placeholder{width:100%;background:#fafafa}.ocr-overlay{color:#fff!important;text-shadow:0 1px 2px rgba(0,0,0,.6)!important;padding:4px 8px!important;border-radius:0!important;display:flex;align-items:center!important;justify-content:center!important;transition:opacity .3s!important;opacity:.95!important;overflow:hidden!important;white-space:pre-wrap!important}.ocr-box{left:var(--pos-x,0);top:var(--pos-y,0);width:var(--box-width,auto);height:var(--box-height,auto);background:linear-gradient(135deg,rgba(44,62,80,.95),rgba(52,73,94,.85));color:#fff;font-weight:400!important;display:flex;justify-content:center!important;align-items:center!important;flex-direction:column!important;-webkit-overflow-scrolling:touch;hyphens:auto!important;-webkit-hyphens:auto!important;line-height:1.2em!important;box-sizing:border-box!important;word-break:break-word!important;letter-spacing:normal!important;border-radius:8px!important;text-align:left!important;padding:2px 4px!important;overflow:auto!important;white-space:normal!important;contain:layout style paint}.ocr-box-text{font-size:100%}.ocr-box-text::-webkit-scrollbar{-webkit-appearance:none;width:0;height:0}.ocr-box::-webkit-scrollbar{-webkit-appearance:none;width:0;height:0}.ocr-box.dragging{user-select:none;-webkit-user-select:none;cursor:move}#pdf-container.dragging{-webkit-user-select:none;user-select:none}.ocr-box.ocr-box-error{background:linear-gradient(135deg,#f8e1e1,#fdf5f5);color:#a94442;box-shadow:0 4px 8px rgba(0,0,0,.05);border-radius:8px;padding:0;overflow:hidden;cursor:pointer}.ocr-box.ocr-box-error:hover{transform:scale(1.02);box-shadow:0 8px 16px rgba(0,0,0,.2)}.ocr-box .spinner{width:auto;height:1em;aspect-ratio:1;border:3px solid rgba(255,255,255,.1)!important;border-top:3px solid transparent!important;border-radius:50%!important;margin:auto!important}.ocr-box.ocr-box-error .ocr-retry-btn{display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#f44336;color:#fff;font-size:clamp(6px, 5vw, 24px);font-weight:500;border:none;outline:0;border-radius:4px;cursor:pointer;text-transform:uppercase;letter-spacing:.5px;position:relative;overflow:hidden;transition:background .3s,box-shadow .3s}.ocr-box.ocr-box-error .ocr-retry-btn:hover{background:#e53935;box-shadow:0 4px 8px rgba(0,0,0,.3)}.ocr-box.ocr-box-error .ocr-retry-btn:active{background:#d32f2f;box-shadow:0 2px 4px rgba(0,0,0,.2)}.ocr-box.ocr-box-error .ocr-retry-btn::after{content:"";position:absolute;top:50%;left:50%;width:5px;height:5px;background:rgba(255,255,255,.5);opacity:0;border-radius:50%;transform:translate(-50%,-50%) scale(1);transition:width .6s ease-out,height .6s ease-out,opacity .6s ease-out}.ocr-box.ocr-box-error .ocr-retry-btn:active::after{width:120%;height:120%;opacity:0;transition:none}.img-container{position:relative!important;display:inline-block!important}#pdf-viewer{position:relative;width:100%;min-height:95%;display:flex;justify-content:center;overflow-x:auto;font-family:var(--md-font-family)}#pdf-toolbar{position:fixed;top:16px;left:50%;transform:translateX(-50%);width:90%;max-width:640px;height:64px;background:var(--md-surface-800);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-radius:var(--md-border-radius-extra-large);display:flex;align-items:center;justify-content:space-between;z-index:1000000;box-shadow:var(--md-shadow-8);padding:0 20px;font-family:var(--md-font-family)}#pdf-toolbar button,#pdfOptionsOverlay{align-items:center;display:flex;font-family:var(--md-font-family)}#pdf-toolbar button{background:rgba(255,255,255,.08);border:none;padding:12px;margin:0 4px;border-radius:var(--md-border-radius-large);font-size:18px;cursor:pointer;justify-content:center;width:48px;height:48px;position:relative;overflow:hidden}#pdf-toolbar button:hover{background:rgba(255,255,255,.12);box-shadow:var(--md-shadow-2)}#pdf-toolbar button:hover::before{opacity:.04}#pdf-toolbar button:active{transform:scale(.96);box-shadow:var(--md-shadow-1)}#pdf-toolbar button:active::before,#pdfOptionsModal button:focus::before{opacity:.12}#pdf-toolbar button:disabled{opacity:.38;cursor:not-allowed;box-shadow:none}#pdf-toolbar button i{font-size:20px}#pdf-toolbar span{font-size:16px;text-align:center;flex-grow:1;padding:0 16px;letter-spacing:.5px}.PDFtextLayer{position:absolute;top:0;left:0;width:100%;height:100%}#pdf-container{margin-top:96px;flex:none;display:flex;flex-direction:column;align-items:center;gap:20px;overflow:visible;position:relative;width:100%;font-family:var(--md-font-family)}#pdf-container .ocr-container{position:relative;width:100%;box-shadow:var(--md-shadow-2);border-radius:var(--md-border-radius-medium);overflow:hidden;background:var(--md-surface-50)}#pdf-container canvas{width:100%!important;height:auto!important;display:block;border-radius:var(--md-border-radius-medium)}#pdfOptionsOverlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.32);justify-content:center;z-index:10000;padding:24px;animation:md-fadein var(--md-transition-duration-long) var(--md-transition-easing-decelerate);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}#pdfOptionsModal{background:var(--md-surface-50);border-radius:var(--md-border-radius-extra-large);padding:24px;width:100%;max-width:400px;box-shadow:var(--md-shadow-12);font-family:var(--md-font-family);color:var(--md-surface-900);opacity:0;transform:translateY(16px) scale(.95);animation:md-slide-up var(--md-transition-duration-long) var(--md-transition-easing-decelerate) forwards}#pdfOptionsModal h2{margin-top:0;font-size:24px;font-weight:var(--md-font-weight-regular);color:var(--md-surface-900);text-align:center;margin-bottom:24px;letter-spacing:.15px}#pdfOptionsModal form>div{margin-bottom:20px}#pdfOptionsModal label{color:var(--md-surface-700);font-size:14px;font-weight:var(--md-font-weight-medium);margin-left:12px;letter-spacing:.25px}#pdfOptionsModal input[type=number],#pdfOptionsModal input[type=text]{width:calc(100% - 24px);padding:16px 12px;margin-top:8px;border:1px solid var(--md-surface-400);border-radius:var(--md-border-radius-small);font-size:16px;font-family:var(--md-font-family);color:var(--md-surface-900);background:var(--md-surface-50);transition:border-color var(--md-transition-duration-short) var(--md-transition-easing-standard),box-shadow var(--md-transition-duration-short) var(--md-transition-easing-standard)}#pdfOptionsModal .quality-container label,#pdfOptionsModal .quality-container span,#pdfOptionsModal button{font-size:14px;font-weight:var(--md-font-weight-medium)}#pdfOptionsModal input[type=number]:focus,#pdfOptionsModal input[type=text]:focus{outline:0;border-color:var(--md-primary-500);box-shadow:0 0 0 2px rgba(33,150,243,.2)}#pdfOptionsModal input[type=radio]{appearance:none;-webkit-appearance:none;width:20px;height:20px;border:2px solid var(--md-surface-400);border-radius:50%;margin-right:12px;position:relative;cursor:pointer}#pdfOptionsModal input[type=radio]:checked{border-color:var(--md-primary-500)}#pdfOptionsModal input[type=radio]:checked::before{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:10px;height:10px;background:var(--md-primary-500);border-radius:50%}#pdfOptionsModal .quality-container{display:flex;align-items:center;justify-content:center;gap:12px;margin:16px 0}#pdfOptionsModal .quality-container label{color:var(--md-surface-700)}#pdfOptionsModal .quality-container input[type=range]{flex:1;margin:0}#pdfOptionsModal .quality-container span{width:48px;text-align:center;color:var(--md-primary-500);background:var(--md-primary-50);padding:4px 8px;border-radius:var(--md-border-radius-small)}#pdfOptionsModal input[type=range]{appearance:none;-webkit-appearance:none;width:100%;height:4px;border-radius:2px;background:var(--md-surface-300);outline:0;transition:background var(--md-transition-duration-short) var(--md-transition-easing-standard)}#pdfOptionsModal input[type=range]::-webkit-slider-runnable-track{width:100%;height:4px;cursor:pointer;background:var(--md-surface-300);border-radius:2px}#pdfOptionsModal input[type=range]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:var(--md-primary-500);cursor:pointer;transition:all var(--md-transition-duration-short) var(--md-transition-easing-standard);box-shadow:var(--md-shadow-1);margin-top:-8px}#pdfOptionsModal input[type=range]::-webkit-slider-thumb:hover{background:var(--md-primary-600);transform:scale(1.1);box-shadow:var(--md-shadow-2)}#pdfOptionsModal .button-group{display:flex;justify-content:flex-end;gap:12px;margin-top:32px}#pdfOptionsModal button{padding:12px 24px;font-family:var(--md-font-family);border:none;border-radius:var(--md-border-radius-large);cursor:pointer;text-transform:uppercase;letter-spacing:.75px;min-width:64px;position:relative;overflow:hidden}#pdfOptionsModal button#cancelPdfOptions{background:0 0;color:var(--md-surface-600);border:1px solid var(--md-surface-300)}#pdfOptionsModal button#cancelPdfOptions:hover{background:var(--md-surface-100);border-color:var(--md-surface-400)}#pdfOptionsModal button#confirmPdfOptions{background:var(--md-primary-500);color:var(--md-surface-50);box-shadow:var(--md-shadow-2)}#pdfOptionsModal button#confirmPdfOptions:hover{background:var(--md-primary-600)}@media (max-width:768px){#pdfOptionsModal{padding:20px;max-width:calc(100vw - 40px);border-radius:var(--md-border-radius-large)}#pdfOptionsModal h2{font-size:22px;margin-bottom:20px}#pdfOptionsModal button{padding:14px 20px;font-size:14px;min-width:80px;min-height:44px}#pdfOptionsModal input[type=number],#pdfOptionsModal input[type=text]{padding:14px 12px;font-size:16px}#pdfOptionsOverlay{padding:20px}#pdf-toolbar{width:95%;height:60px;padding:0 16px;top:12px}#pdf-toolbar button{width:42px;height:42px;margin:0 2px;font-size:16px;min-width:44px;min-height:44px}#pdf-toolbar button i{font-size:18px}#pdf-toolbar span{font-size:15px;padding:0 12px}#pdf-container{margin-top:88px;gap:16px;width:100%}#pdf-toolbar #pageIndicator,#pdf-toolbar #zoomIndicator{font-size:13px}}@media (max-width:480px){#pdfOptionsModal .quality-container{flex-direction:column;align-items:center}#pdfOptionsModal{padding:16px;max-width:calc(100vw - 24px);border-radius:var(--md-border-radius-medium)}#pdfOptionsModal h2{font-size:20px;margin-bottom:16px}#pdfOptionsModal button{padding:12px 16px;font-size:14px;min-width:72px;min-height:44px}#pdfOptionsModal button#confirmPdfOptions{flex:1}#pdfOptionsModal .quality-container{flex-direction:column;align-items:stretch;gap:12px}#pdfOptionsModal .quality-container input[type=range]{width:100%;margin:8px 0}#pdfOptionsModal .quality-container span{text-align:center;align-self:center}#pdfOptionsModal input[type=number],#pdfOptionsModal input[type=text]{padding:12px 10px;font-size:16px;width:calc(100% - 20px)}#pdfOptionsOverlay{padding:12px}#pdf-toolbar{height:56px;padding:0 12px;top:8px}#pdf-toolbar button{width:38px;height:38px;margin:0 1px;font-size:14px}#pdf-toolbar button i{font-size:16px}#pdf-toolbar span{font-size:14px;padding:0 8px}#pdf-container{margin-top:80px;gap:12px;width:100%}#pdf-toolbar #pageIndicator,#pdf-toolbar #zoomIndicator{font-size:12px}.ocr-box{padding:1px 2px!important;border-radius:4px!important}.ocr-overlay{padding:2px 4px!important}}\n', 
            document.head.appendChild(style);
        }
        initUI() {
            if (this.created) return;
            const container = this.createTranslationContainer();
            container && !document.getElementById("resetButton") && container.appendChild(this._createResetButton()), 
            document.getElementById("translationFeedbackBox") || container.appendChild(this.createFeedbackBox()), 
            BaseUIManager._detectTheme(), setTimeout(() => BaseUIManager._detectTheme(), 3e3),
            setTimeout(() => {
                container && container.classList.add("hidden");
            }, 1e3), this.created = !0;
        }
        removeUI(duration = 2e3) {
            if (this.removed) return;
            document.getElementById("translationContainer").classList.remove("hidden");
            const box = document.getElementById("translationFeedbackBox");
            setTimeout(() => {
                if (!box || !box.parentElement) return;
                box.classList.add("fade-out"), box.addEventListener("animationend", () => {
                    box.remove(), document.getElementById("translationContainer").classList.remove("hidden");
                });
            }, duration), this.removed = !0;
        }
        _createResetButton() {
            const resetBtn = document.createElement("button");
            return resetBtn.className = "immTransl-control-btn reset", resetBtn.title = "Reset", 
            resetBtn.id = "resetButton", resetBtn.innerHTML = '<svg version="1.0" xmlns="http://www.w3.org/2000/svg"      width="24.000000pt" height="24.000000pt" viewBox="0 0 512.000000 512.000000"      preserveAspectRatio="xMidYMid meet">     <g transform="translate(0.000000,512.000000) scale(0.100000,-0.100000)"     fill="#fff" stroke="none">     <path d="M2390 4794 c-441 -40 -832 -189 -1180 -448 -123 -91 -346 -315 -436     -436 -229 -308 -373 -652 -431 -1030 -24 -158 -24 -482 0 -640 50 -325 167     -635 341 -900 98 -149 164 -230 300 -366 344 -343 765 -554 1256 -630 159 -25     481 -25 640 0 825 127 1497 673 1784 1450 55 148 49 224 -23 289 -46 41 -68     49 -229 82 -128 26 -162 25 -222 -6 -60 -30 -97 -79 -139 -183 -145 -354 -401     -644 -726 -822 -726 -395 -1636 -169 -2097 520 -367 549 -355 1274 30 1816 86     121 251 286 372 372 169 120 400 223 592 262 439 90 826 4 1190 -266 l80 -60     -181 -182 c-116 -118 -187 -197 -197 -222 -53 -124 21 -267 151 -294 34 -7     256 -10 661 -8 l609 3 45 25 c24 14 58 45 75 68 l30 44 3 646 2 646 -26 53     c-33 69 -103 113 -180 113 -87 0 -130 -30 -343 -244 l-194 -194 -76 60 c-308     246 -651 403 -1011 463 -92 16 -379 27 -470 19z"/>     </g>     </svg>', 
            resetBtn.disabled = !1, resetBtn.addEventListener("click", b => {
                ImmUtils.resetTranslation(BaseUIManager.showNotification, this.updateFeedback), 
                b.remove;
            }), resetBtn;
        }
        _createControlButtons() {
            const controlContainer = document.createElement("div");
            controlContainer.id = "translationControls";
            const pauseBtn = document.createElement("button");
            pauseBtn.className = "immTransl-control-btn pause", pauseBtn.title = "Pause", pauseBtn.innerHTML = '<svg version="1.0" xmlns="http://www.w3.org/2000/svg" width="12.000000pt" height="12.000000pt" viewBox="0 0 512.000000 512.000000" preserveAspectRatio="xMidYMid meet">    <g transform="translate(0.000000,512.000000) scale(0.100000,-0.100000)" fill="#fff" stroke="none">    <path d="M774 5104 c-16 -8 -39 -29 -50 -47 -19 -31 -19 -71 -19 -2497 0 -2429 0 -2465 20 -2497 38 -64 23 -63 660 -63 631 0 622 -1 662 58 17 26 18 131 18 2502 0 2371 -1 2476 -18 2502 -40 59 -31 58 -664 58 -494 0 -582 -3 -609 -16z"/>    <path d="M3123 5104 c-18 -9 -40 -28 -50 -43 -17 -25 -18 -135 -18 -2501 0 -2371 1 -2476 18 -2502 40 -59 31 -58 662 -58 637 0 622 -1 660 63 20 32 20     68 20 2497 0 2429 0 2465 -20 2497 -38 64 -23 63 -662 63 -506 0 -582 -2 -610 -16z"/></g></svg>    ', 
            pauseBtn.disabled = !1;
            const resumeBtn = document.createElement("button");
            resumeBtn.className = "immTransl-control-btn resume", resumeBtn.title = "Resume", 
            resumeBtn.innerHTML = '<svg version="1.0" xmlns="http://www.w3.org/2000/svg"       // width="12pt" height="12pt" viewBox="0 0 512.000000 512.000000"     preserveAspectRatio="xMidYMid meet">    <g transform="translate(0.000000,512.000000) scale(0.100000,-0.100000)"    fill="#fff" stroke="none">    <path d="M620 5110 c-71 -15 -151 -60 -206 -115 -86 -85 -137 -210 -154 -375    -13 -129 -13 -3991 0 -4120 17 -165 68 -290 154 -375 149 -149 373 -163 619    -39 76 37 3457 1975 3546 2031 31 20 90 70 131 112 159 161 196 340 107 521    -37 76 -152 198 -238 253 -89 56 -3470 1994 -3546 2031 -37 19 -97 44 -133 56    -74 24 -214 34 -280 20z"/>    </g>    </svg>', 
            resumeBtn.disabled = !0;
            const cancelBtn = document.createElement("button");
            return cancelBtn.className = "immTransl-control-btn cancel", cancelBtn.title = "Cancel", 
            cancelBtn.innerHTML = '<svg version="1.0" xmlns="http://www.w3.org/2000/svg"      width="12.000000pt" height="12.000000pt" viewBox="0 0 512.000000 512.000000"      preserveAspectRatio="xMidYMid meet">     <g transform="translate(0.000000,512.000000) scale(0.100000,-0.100000)"     fill="#fff" stroke="none">     <path d="M579 5107 c-26 -7 -68 -27 -95 -45 -58 -37 -401 -381 -431 -432 -36     -60 -56 -147 -49 -212 14 -133 -28 -86 888 -1003 461 -462 838 -847 838 -855     0 -8 -377 -393 -838 -855 -911 -912 -873 -869 -888 -997 -8 -72 17 -169 61     -233 19 -28 117 -132 217 -231 223 -221 254 -239 393 -239 164 1 96 -57 1044     891 458 459 838 833 843 832 6 -2 385 -378 842 -835 944 -944 878 -887 1041     -888 139 0 170 18 393 239 100 99 198 203 217 231 44 64 69 161 61 233 -15     128 23 85 -888 997 -461 462 -838 847 -838 855 0 8 377 393 838 855 911 912     873 869 888 997 8 72 -17 169 -61 233 -19 28 -117 132 -217 231 -223 221 -254     239 -393 239 -163 -1 -97 56 -1042 -889 -457 -457 -837 -831 -843 -831 -7 0     -386 374 -844 831 -741 741 -837 835 -890 859 -70 32 -177 42 -247 22z"/>     </g>     </svg>', 
            cancelBtn.disabled = !1, pauseBtn.addEventListener("click", () => {
                translationPaused || (ImmUtils.pauseTranslation(BaseUIManager.showNotification, this.updateFeedback), 
                pauseBtn.disabled = !0, resumeBtn.disabled = !1);
            }), resumeBtn.addEventListener("click", () => {
                translationPaused && (ImmUtils.resumeTranslation(BaseUIManager.showNotification, this.updateFeedback), 
                resumeBtn.disabled = !0, pauseBtn.disabled = !1);
            }), cancelBtn.addEventListener("click", () => {
                translationCanceled || (ImmUtils.cancelTranslation(BaseUIManager.showNotification, this.updateFeedback),
                this._translationStopped = !0,
                pauseBtn.disabled = !0, resumeBtn.disabled = !0, cancelBtn.disabled = !0, this.removeFeedback(0),
                download && (document.getElementById("downloadPdf").disabled = !1), document.querySelectorAll(".text-spinner, .text-retry-button").forEach(el => el.remove()),
                document.querySelectorAll(".ocr-box").forEach(box => {
                    if (box.querySelector(":scope > .spinner")) return void box.remove();
                    const info = box.getAttribute("data-ocr-info");
                    if (!info) return void box.remove();
                    try { const d = JSON.parse(info); d.translatedText && "" !== d.translatedText && "[[ERROR]]" !== d.translatedText || box.remove(); } catch (e) { box.remove(); }
                }),
                setTimeout(() => {
                    document.querySelectorAll(".ocr-box").forEach(box => {
                        if (box.querySelector(":scope > .spinner")) return void box.remove();
                        const info = box.getAttribute("data-ocr-info");
                        if (!info) return void box.remove();
                        try { const d = JSON.parse(info); d.translatedText && "" !== d.translatedText && "[[ERROR]]" !== d.translatedText || box.remove(); } catch (e) { box.remove(); }
                    });
                }, 500),
                this.pageContainers && this.pageContainers.forEach(c => {
                    if (!c._translationCache) return;
                    const valid = c._translationCache.blocks.filter(b => b && b.translatedText && "" !== b.translatedText && "[[ERROR]]" !== b.translatedText);
                    valid.length > 0 ? c._translationCache = { blocks: valid } : delete c._translationCache;
                }));
            }), controlContainer.appendChild(pauseBtn), controlContainer.appendChild(resumeBtn),
            controlContainer.appendChild(cancelBtn), controlContainer;
        }
        createTranslationContainer() {
            let mainUIContainer = document.getElementById("immersiveTranslatorUI");
            if (mainUIContainer || (mainUIContainer = document.createElement("div"), mainUIContainer.id = "immersiveTranslatorUI", 
            document.body.appendChild(mainUIContainer)), document.getElementById("notificationContainer")) {
                const existingContainer = document.getElementById("notificationContainer");
                existingContainer.parentNode !== mainUIContainer && mainUIContainer.appendChild(existingContainer);
            } else {
                const notificationContainer = document.createElement("div");
                notificationContainer.id = "notificationContainer", mainUIContainer.appendChild(notificationContainer);
            }
            if (!document.getElementById("translationContainer")) {
                const container = document.createElement("div");
                return container.id = "translationContainer", mainUIContainer.appendChild(container),
                container;
            }
            return document.getElementById("translationContainer");
        }
        createFeedbackBox() {
            let box = document.getElementById("translationFeedbackBox");
            if (!box) {
                box = document.createElement("div"), box.id = "translationFeedbackBox";
                const arrow = document.createElement("div");
                arrow.className = "immTransl-arrow", arrow.innerHTML = '<svg version="1.0" xmlns="http://www.w3.org/2000/svg"\n             width="32.000000pt" height="32.000000pt" viewBox="0 0 512.000000 512.000000"\n             preserveAspectRatio="xMidYMid meet">\n            <g transform="translate(0.000000,512.000000) scale(0.100000,-0.100000)"\n            fill="#fff" stroke="none">\n            <path d="M1400 5098 c-44 -17 -77 -44 -171 -137 -144 -143 -163 -177 -164\n            -286 0 -58 5 -91 19 -120 13 -27 333 -355 995 -1018 l976 -977 -977 -978\n            c-760 -760 -982 -987 -997 -1022 -14 -30 -21 -67 -21 -110 0 -103 29 -153 168\n            -291 98 -97 127 -119 175 -137 73 -28 131 -28 204 -1 56 20 108 71 1230 1193\n            1297 1296 1223 1214 1223 1346 0 132 74 50 -1223 1346 -1123 1123 -1174 1173\n            -1230 1193 -72 26 -136 26 -207 -1z"/>\n            </g>\n            </svg>\n              ', 
                arrow.addEventListener("click", function(e) {
                    e.stopPropagation(), document.getElementById("translationContainer").classList.toggle("hidden");
                }), box.appendChild(arrow);
                const spinner = document.createElement("div");
                spinner.className = "spinner", spinner.addEventListener("click", function(e) {
                    e.stopPropagation(), box.classList.toggle("hidden");
                }), box.appendChild(spinner);
                const text = document.createElement("span");
                text.id = "feedbackText", text.textContent = "Starting translation...", box.appendChild(text), 
                box.appendChild(this._createControlButtons()), document.body.appendChild(box);
            }
            return box;
        }
        updateFeedback(message, showSpinner = !0) {
            const box = document.getElementById("translationFeedbackBox");
            if (box) {
                const text = document.getElementById("feedbackText");
                text && message && (text.textContent = message);
                const spinner = box.querySelector(".spinner");
                spinner && (showSpinner ? spinner.classList.remove("spinner-hidden") : spinner.classList.add("spinner-hidden"));
            }
        }
        removeFeedback(delay = 2e3) {
            document.getElementById("translationContainer").classList.remove("hidden");
            const box = document.getElementById("translationFeedbackBox");
            setTimeout(() => {
                if (!box || !box.parentElement) return;
                box.classList.add("fade-out"), box.addEventListener("animationend", () => {
                    box.remove(), document.getElementById("translationContainer").classList.remove("hidden");
                });
            }, delay);
        }
        static _detectTheme() {
            const ui = document.getElementById("immersiveTranslatorUI");
            if (!ui) return;
            const parse = s => { const m = s.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/); return m ? { r: +m[1], g: +m[2], b: +m[3], a: void 0 !== m[4] ? +m[4] : 1 } : null; };
            const lum = c => { const s = [c.r, c.g, c.b].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * s[0] + .7152 * s[1] + .0722 * s[2]; };
            let color = parse(getComputedStyle(document.body).backgroundColor);
            if (!color || color.a < .1) color = parse(getComputedStyle(document.documentElement).backgroundColor);
            if (color && color.a >= .1) { lum(color) < .35 ? ui.classList.add("immTransl-light") : ui.classList.remove("immTransl-light"); }
        }
        static showNotification(message, severity, duration) {
            (new NotificationManager).showNotification(message, severity, duration);
        }
    }
    class PageUIManager extends BaseUIManager {
        constructor() {
            super();
        }
        initUI() {
            this.created || (super.initUI(), this.addCSS());
        }
    }
    class HiddenUIManager extends BaseUIManager {
        constructor() {
            super();
        }
        initUI() {}
        removeUI() {}
    }
    class PDFUIManager extends BaseUIManager {
        constructor() {
            super(), this.currentPageIndex = 0, this.totalPages = 0, this.pageContainers = [], 
            this.zoomFactor = 1, this.zoomStep = .1, this.minZoom = .1, this.maxZoom = 2, this.panzoom = null;
        }
        static showNotification(message, severity, duration) {
            super.showNotification(message, severity, duration);
        }
        initUI() {
            this.buildPdfViewer(), super.initUI();
        }
        removeUI(duration) {
            download && PDFUIManager.enableDownloadButton(), super.removeUI(duration);
        }
        async exportPdfCallback() {
            const containers = document.querySelectorAll(".ocr-container");
            if (0 === containers.length) return;
            containers.forEach(c => c.querySelectorAll(".ocr-box").forEach(box => {
                const info = box.getAttribute("data-ocr-info");
                if (!info) return void box.remove();
                try { const d = JSON.parse(info); d.translatedText && "" !== d.translatedText || box.remove(); } catch (e) { box.remove(); }
            }));
            this._exporting = !0;
            try {
                const unrendered = Array.from(containers).filter(c => "placeholder" === c.dataset.pageState || "rendering" === c.dataset.pageState);
                if (unrendered.length > 0) {
                    BaseUIManager.showNotification("Rendering remaining pages for export...", "warning");
                    for (const c of unrendered) {
                        while ("rendering" === c.dataset.pageState) await ImmUtils.sleep(100);
                        if ("placeholder" === c.dataset.pageState && this.pdfDoc) {
                            await ProcessPdfPageFacede.renderPage(this.pdfDoc, parseInt(c.dataset.pageNum), c);
                            if (c._translationCache) this._applyCachedTranslation(c);
                        }
                    }
                }
                const maxPages = containers.length, options = await PDFUIManager.showPdfOptionsModal(maxPages), pdfExporter = new PdfExporterFacade, exportCommand = new ExportPdfCommand(pdfExporter);
                try {
                    await exportCommand.execute(options, PDFUIManager.showNotification);
                } catch (error) {
                    PDFUIManager.showNotification(error, "error");
                }
            } finally {
                this._exporting = !1;
            }
        }
        buildPdfViewer() {
            let viewer = document.getElementById("pdf-viewer");
            viewer || (viewer = document.createElement("div"), viewer.id = "pdf-viewer", document.body.appendChild(viewer));
            let toolbar = document.getElementById("pdf-toolbar");
            toolbar || (toolbar = document.createElement("div"), toolbar.id = "pdf-toolbar", 
            toolbar.innerHTML = '\n            <button id="prevPage"><i class="fas fa-arrow-left"></i></button>\n            <span id="pageIndicator">0 of 0</span>\n            <button id="nextPage"><i class="fas fa-arrow-right"></i></button>\n   \n            <button id="zoomOut"><i class="fas fa-search-minus"></i></button>\n            <span id="zoomIndicator">100%</span>\n            <button id="zoomIn"><i class="fas fa-search-plus"></i></button>\n\n            <button id="downloadPdf" disabled><i class="fas fa-download"></i></button>\n          ', 
            document.body.appendChild(toolbar));
            let pdfContainer = document.getElementById("pdf-container");
            pdfContainer || (pdfContainer = document.createElement("div"), pdfContainer.id = "pdf-container", 
            viewer.appendChild(pdfContainer));
            document.getElementById("downloadPdf").addEventListener("click", this.exportPdfCallback.bind(this));
        }
        static async showPdfOptionsModal(maxPages) {
            return new Promise((resolve, reject) => {
                if (document.getElementById("pdfOptionsOverlay")) return;
                const overlay = document.createElement("div");
                overlay.id = "pdfOptionsOverlay";
                const modal = document.createElement("div");
                modal.id = "pdfOptionsModal", modal.innerHTML = '\n          <h2>PDF Options</h2>\n          <form id="pdfOptionsForm">\n            <div>\n              <input type="radio" id="optionAll" name="pdfOption" value="all" checked>\n              <label for="optionAll">Entire PDF</label>\n            </div>\n            <div>\n              <input type="radio" id="optionSpecific" name="pdfOption" value="specific">\n              <label for="optionSpecific">Specific Pages</label>\n              <input type="text" id="specificPages" placeholder="e.g. 1,3,5" disabled>\n            </div>\n            <div>\n              <input type="radio" id="optionRange" name="pdfOption" value="range">\n              <label for="optionRange">Page Range</label>\n              <div style="display: flex; gap: 10px; margin-top: 8px;">\n                <input type="number" id="rangeStart" placeholder="From" disabled>\n                <input type="number" id="rangeEnd" placeholder="To" disabled>\n              </div>\n            </div>\n            <div class="quality-container">\n              <label for="pdfQuality">PDF Quality (Optimal 70%):</label>\n              <input type="range" id="pdfQuality" min="10" max="100" value="70" style="vertical-align: middle; margin: 0 8px;">\n              <span id="pdfQualityValue">70%</span>\n            </div>\n            <div class="button-group">\n              <button type="button" id="cancelPdfOptions">Cancel</button>\n              <button type="submit" id="confirmPdfOptions">Download</button>\n            </div>\n          </form>\n          ', 
                overlay.appendChild(modal), document.body.appendChild(overlay);
                const pdfQualitySlider = modal.querySelector("#pdfQuality"), pdfQualityValue = modal.querySelector("#pdfQualityValue");
                pdfQualitySlider.addEventListener("input", () => {
                    pdfQualityValue.textContent = pdfQualitySlider.value + "%";
                });
                const specificPagesInput = modal.querySelector("#specificPages"), rangeStartInput = modal.querySelector("#rangeStart"), rangeEndInput = modal.querySelector("#rangeEnd");
                rangeStartInput.setAttribute("min", "1"), rangeStartInput.setAttribute("max", maxPages), 
                rangeEndInput.setAttribute("min", "1"), rangeEndInput.setAttribute("max", maxPages);
                modal.querySelectorAll('input[name="pdfOption"]').forEach(radio => {
                    radio.addEventListener("change", () => {
                        specificPagesInput.disabled = !modal.querySelector("#optionSpecific").checked, rangeStartInput.disabled = !modal.querySelector("#optionRange").checked, 
                        rangeEndInput.disabled = !modal.querySelector("#optionRange").checked;
                    });
                });
                modal.querySelector("#pdfOptionsForm").addEventListener("submit", e => {
                    e.preventDefault();
                    const selectedOption = modal.querySelector('input[name="pdfOption"]:checked').value, result = {
                        type: selectedOption,
                        quality: modal.querySelector("#pdfQuality").value / 100
                    };
                    if ("range" === selectedOption) {
                        const start = parseInt(rangeStartInput.value), end = parseInt(rangeEndInput.value);
                        if (isNaN(start) || isNaN(end)) return void alert("Please enter valid numbers for the range.");
                        if (start < 1 || end < 1 || start > maxPages || end > maxPages) return void alert(`The range must be between 1 and ${maxPages}.`);
                        if (start > end) {
                            return void alert("The starting page cannot be greater than the ending page.");
                            s;
                        }
                        result.range = {
                            start: start,
                            end: end
                        };
                    } else if ("specific" === selectedOption) {
                        let pages = specificPagesInput.value.split(",").map(num => parseInt(num.trim())).filter(num => !isNaN(num));
                        if (0 === pages.length) return void alert("Please enter at least one valid page number.");
                        if (pages.filter(page => page < 1 || page > maxPages).length > 0) return void alert(`All page numbers must be between 1 and ${maxPages}.`);
                        result.pages = pages;
                    }
                    document.body.removeChild(overlay), resolve(result);
                });
                modal.querySelector("#cancelPdfOptions").addEventListener("click", () => {
                    document.body.removeChild(overlay);
                });
            });
        }
        applyZoom() {
            const pdfContainer = document.getElementById("pdf-container");
            if (!pdfContainer || !this.baseWidth) return;
            const scrollRatio = window.scrollY / Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
            pdfContainer.style.width = (this.baseWidth * this.zoomFactor) + "px";
            requestAnimationFrame(() => {
                const newMaxScroll = document.documentElement.scrollHeight - window.innerHeight;
                window.scrollTo({top: scrollRatio * newMaxScroll});
                this._adjustAllFontSizes();
            });
        }
        _adjustAllFontSizes() {
            this.pageContainers.forEach(container => {
                container.querySelectorAll(".ocr-box").forEach(box => {
                    try { OCRStrategy.adjustFontSize(box); } catch(e) {}
                });
            });
        }
        zoomIn() {
            this.zoomFactor < this.maxZoom && (this.zoomFactor = Math.min(this.maxZoom, this.zoomFactor + this.zoomStep), 
            this.applyZoom(), this.updateZoomIndicator());
        }
        zoomOut() {
            if (this.zoomFactor > this.minZoom) {
                this.zoomFactor;
                this.zoomFactor = Math.max(this.minZoom, this.zoomFactor - this.zoomStep), this.applyZoom(), 
                this.updateZoomIndicator();
            }
        }
        updateZoomIndicator() {
            const indicator = document.getElementById("zoomIndicator"), percentage = Math.round(100 * this.zoomFactor);
            indicator.textContent = `${percentage}%`;
        }
        updatePageIndicator() {
            document.getElementById("pageIndicator").textContent = `${this.currentPageIndex + 1} of ${this.totalPages}`;
        }
        showCurrentPage() {
            if (this.pageContainers.forEach((container, index) => {
                container.style.display = "block";
            }), this.pageContainers[this.currentPageIndex]) {
                const target = this.pageContainers[this.currentPageIndex];
                target.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
                target.querySelector("canvas");
                if ("placeholder" === target.dataset.pageState) {
                    this._queueRender(target);
                }
            }
        }
        addToolbarListeners(pdfDoc, worker, translator, scale) {
            document.getElementById("pdf-container");
            document.getElementById("prevPage").addEventListener("click", async () => {
                this.currentPageIndex > 0 && (this.currentPageIndex--, this.showCurrentPage());
            }), document.getElementById("nextPage").addEventListener("click", () => {
                this.currentPageIndex < this.totalPages - 1 && (this.currentPageIndex++, this.showCurrentPage());
            }), document.getElementById("zoomIn").addEventListener("click", () => {
                this.zoomIn();
            }), document.getElementById("zoomOut").addEventListener("click", () => {
                this.zoomOut();
            });
        }
        async createPdfPages(pdfDoc) {
            this.totalPages = pdfDoc.numPages;
            this.pdfDoc = pdfDoc;
            this._renderingPages = new Set();
            this._renderQueue = new Set();
            this._drainingQueue = !1;
            const pageTrackingObserver = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    const requiredVisibility = (() => {
                        const viewportWidth = window.innerWidth;
                        return viewportWidth <= 600 ? .5 : viewportWidth <= 1200 ? .35 : viewportWidth <= 1800 ? .25 : .15;
                    })();
                    entry.isIntersecting && entry.intersectionRatio >= requiredVisibility && (this.currentPageIndex = Array.from(this.pageContainers).indexOf(entry.target),
                    this.updatePageIndicator());
                });
            }, {
                root: null,
                threshold: [ 0, .15, .25, .35, .5, .75, 1 ],
                rootMargin: "0px"
            });
            this.pageContainers = [];
            const firstPage = await pdfDoc.getPage(1);
            const initScale = Math.min(window.devicePixelRatio || 1, 2);
            const initViewport = firstPage.getViewport({ scale: initScale, dontFlip: !1 });
            const pdfContainer = document.getElementById("pdf-container");
            this.baseWidth = Math.min(initViewport.width, pdfContainer ? pdfContainer.parentElement.clientWidth : window.innerWidth);
            pdfContainer && (pdfContainer.style.width = this.baseWidth + "px");
            for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
                const container = await ProcessPdfPageFacede.createPlaceholder(pdfDoc, pageNum);
                this.pageContainers.push(container), pageTrackingObserver.observe(container);
            }
            this.renderObserver = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const container = entry.target;
                        if ("placeholder" === container.dataset.pageState) {
                            this._queueRender(container);
                        }
                    }
                });
            }, {
                root: null,
                rootMargin: "100% 0px"
            });
            this.unloadObserver = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) {
                        const container = entry.target;
                        const state = container.dataset.pageState;
                        if ("rendered" === state || "translated" === state) {
                            this._unloadPage(container);
                        }
                    }
                });
            }, {
                root: null,
                rootMargin: "200% 0px"
            });
            this.pageContainers.forEach(c => {
                this.renderObserver.observe(c);
                this.unloadObserver.observe(c);
            });
            const initialPages = Math.min(3, this.totalPages);
            for (let i = 0; i < initialPages; i++) {
                await this._renderPage(this.pageContainers[i]);
            }
            return this.currentPageIndex = 0, this.showCurrentPage(), this.addToolbarListeners(),
            this.updateZoomIndicator(), this.pageContainers;
        }
        _queueRender(container) {
            if ("placeholder" !== container.dataset.pageState) return;
            this._renderQueue.add(container);
            this._drainRenderQueue();
        }
        async _drainRenderQueue() {
            if (this._drainingQueue) return;
            this._drainingQueue = !0;
            while (this._renderQueue.size > 0 && this._renderingPages.size < 2) {
                let best = null, bestDist = 1 / 0;
                for (const c of this._renderQueue) {
                    if ("placeholder" !== c.dataset.pageState) { this._renderQueue.delete(c); continue; }
                    const dist = Math.abs(this.pageContainers.indexOf(c) - this.currentPageIndex);
                    dist < bestDist && (bestDist = dist, best = c);
                }
                if (!best) break;
                this._renderQueue.delete(best);
                await this._renderPage(best);
            }
            this._drainingQueue = !1;
        }
        _unloadPage(container) {
            if (this._exporting) return;
            const pageNum = parseInt(container.dataset.pageNum);
            if (this._renderingPages.has(pageNum)) return;
            const canvas = container.querySelector("canvas");
            if (!canvas) return;
            const ocrBoxes = Array.from(container.querySelectorAll(".ocr-box"))
                .sort((a, b) => parseInt(a.getAttribute("data-ocr-index"), 10) - parseInt(b.getAttribute("data-ocr-index"), 10));
            if (ocrBoxes.length > 0) {
                const blocks = ocrBoxes.map(box => {
                    try {
                        const data = JSON.parse(box.getAttribute("data-ocr-info"));
                        if (!data.translatedText || "" === data.translatedText || "[[ERROR]]" === data.translatedText) return null;
                        data._cachedStyles = {
                            background: box.style.background,
                            color: box.style.color,
                            writingMode: box.style.writingMode,
                            transform: box.style.transform,
                            transformOrigin: box.style.transformOrigin,
                            rotation: box.dataset.rotation || "0"
                        };
                        return data;
                    } catch (e) { return null; }
                }).filter(b => b !== null);
                if (blocks.length > 0) container._translationCache = { blocks: blocks };
            }
            ocrBoxes.forEach(b => b.remove());
            container._ocrBoxes = null;
            canvas.width = 0;
            canvas.height = 0;
            canvas.remove();
            container.classList.add("ocr-placeholder");
            container.dataset.pageState = "placeholder";
        }
        _enforceMaxRendered() {
            if (this._exporting) return;
            const MAX_RENDERED = 8;
            const rendered = this.pageContainers.filter(c => {
                const s = c.dataset.pageState;
                return ("rendered" === s || "translated" === s) && !this._renderingPages.has(parseInt(c.dataset.pageNum));
            });
            if (rendered.length <= MAX_RENDERED) return;
            const current = this.currentPageIndex;
            rendered.sort((a, b) => {
                const distA = Math.abs(this.pageContainers.indexOf(a) - current);
                const distB = Math.abs(this.pageContainers.indexOf(b) - current);
                return distB - distA;
            });
            for (let i = 0; i < rendered.length - MAX_RENDERED; i++) {
                this._unloadPage(rendered[i]);
            }
        }
        async _renderPage(container) {
            const pageNum = parseInt(container.dataset.pageNum);
            if ("placeholder" !== container.dataset.pageState || this._renderingPages.has(pageNum)) return;
            this._renderingPages.add(pageNum);
            try {
                await ProcessPdfPageFacede.renderPage(this.pdfDoc, pageNum, container);
                if ("rendered" === container.dataset.pageState) {
                    if (container._translationCache) {
                        this._applyCachedTranslation(container);
                    } else if (!this._translationStopped && !ImmUtils.isCancelled()) {
                        this._createPreviewBoxes(container);
                    }
                }
            } finally {
                this._renderingPages.delete(pageNum);
                this._enforceMaxRendered();
                this._drainRenderQueue();
            }
        }
        _createPreviewBoxes(container) {
            const canvas = container.querySelector("canvas");
            if (!canvas || !canvas.pdfTextContent) return;
            const {text: textPage, viewport} = canvas.pdfTextContent;
            if (!textPage || !textPage.items || 0 === textPage.items.length) return;
            const ocrResult = PdfPageOCRStrategy.mapPdfTextToOcrResult(textPage, viewport);
            const filteredLines = ocrResult.data.lines.filter(l => "" !== l.text.trim());
            if (0 === filteredLines.length) return;
            const rawOcrData = filteredLines.map(line => ({
                bbox: line.bbox, baseline: line.baseline, translatedText: "", text: line.text.trim()
            }));
            const blocks = OCRStrategy.groupOcrData(rawOcrData, 18);
            if (0 === blocks.length) return;
            canvas.ocrBaseWidth = canvas.width, canvas.ocrBaseHeight = canvas.height;
            const baseWidth = canvas.ocrBaseWidth, baseHeight = canvas.ocrBaseHeight;
            const boxesVisible = translationActive;
            const fragment = document.createDocumentFragment();
            blocks.forEach((block, i) => {
                if (!block) return;
                const box = document.createElement("div");
                box.className = "ocr-box", box.dataset.index = i,
                box.setAttribute("data-ocr-index", i),
                box.setAttribute("data-ocr-info", JSON.stringify(block));
                if (!boxesVisible) box.style.display = "none";
                const {bbox, baseline} = block;
                box.style.setProperty("--pos-x", `${(bbox.x0 / baseWidth) * 100}%`),
                box.style.setProperty("--pos-y", `${(bbox.y0 / baseHeight) * 100}%`),
                box.style.setProperty("--box-width", `${((bbox.x1 - bbox.x0) / baseWidth) * 100}%`),
                box.style.setProperty("--box-height", `${((bbox.y1 - bbox.y0) / baseHeight) * 100}%`);
                this._applyRotationFromBaseline(box, bbox, baseline);
                const spinner = document.createElement("div");
                spinner.className = "spinner", box.appendChild(spinner);
                box.contentEditable = "false";
                fragment.appendChild(box);
            });
            container.appendChild(fragment);
            container._hasPreviewBoxes = !0;
        }
        _applyRotationFromBaseline(box, bbox, baseline) {
            if (!baseline || void 0 === baseline.x0 || void 0 === baseline.y0 || void 0 === baseline.x1 || void 0 === baseline.y1) {
                box.dataset.rotation = 0;
                return;
            }
            let angleDeg = 0, isVertical = !1;
            const dx = baseline.x1 - baseline.x0, dy = baseline.y1 - baseline.y0;
            const threshold = Math.sqrt(dx * dx + dy * dy) * Math.cos(80 * Math.PI / 180);
            if (Math.abs(dx) < threshold) {
                isVertical = !0;
                const bw = bbox.x1 - bbox.x0;
                bbox.y1 - bbox.y0 < 1.5 * bw && (angleDeg = Math.atan2(dy, dx) * (180 / Math.PI),
                angleDeg > 90 ? angleDeg -= 180 : angleDeg < -90 && (angleDeg += 180));
            } else angleDeg = Math.atan2(dy, dx) * (180 / Math.PI),
                angleDeg > 90 ? angleDeg -= 180 : angleDeg < -90 && (angleDeg += 180);
            let rotationTransform = "";
            isVertical ? 90 !== angleDeg && -90 !== angleDeg ? (box.style.writingMode = "vertical-rl",
            box.style.transformOrigin = "center center") : (box.style.transformOrigin = "bottom left",
            dy < 0 && (rotationTransform = `rotate(${angleDeg}deg) scaleX(1)`)) : (rotationTransform = `rotate(${angleDeg}deg)`,
            box.style.transformOrigin = "top left");
            box.dataset.rotation = angleDeg, box.style.transform = rotationTransform;
        }
        _applyCachedTranslation(container) {
            if (this._translationStopped && !container._translationCache) return;
            const cache = container._translationCache;
            if (!cache || !cache.blocks || 0 === cache.blocks.length) return;
            const canvas = container.querySelector("canvas");
            if (!canvas) return;
            if (container._hasPreviewBoxes) {
                container.querySelectorAll(".ocr-box").forEach(b => b.remove());
                container._ocrBoxes = null;
                delete container._hasPreviewBoxes;
            }
            canvas.ocrBaseWidth = canvas.width, canvas.ocrBaseHeight = canvas.height,
            canvas.dataset.ocrProcessed = "true", container.dataset.pageState = "translated";
            if (this.ocrManager) canvas.ocrTranslator = this.ocrManager.getTranslatorService();
            const baseWidth = canvas.ocrBaseWidth, baseHeight = canvas.ocrBaseHeight;
            const boxesVisible = translationActive;
            const fragment = document.createDocumentFragment();
            const createdBoxes = [];
            cache.blocks.forEach((block, i) => {
                if (!block) return;
                const box = document.createElement("div");
                box.className = "ocr-box", box.dataset.index = i,
                box.setAttribute("data-ocr-index", i),
                box.setAttribute("data-ocr-info", JSON.stringify(block));
                box._keydownHandler = function(e) {
                    if ("Backspace" === e.key && "" === box.innerText.trim()) {
                        e.preventDefault(), box.remove();
                    }
                }, box.addEventListener("keydown", box._keydownHandler), box._beforeinputHandler = function(e) {
                    if ("deleteContentBackward" === e.inputType && "" === box.innerText.trim()) {
                        e.preventDefault(), box.remove();
                    }
                }, box.addEventListener("beforeinput", box._beforeinputHandler);
                if (!boxesVisible) box.style.display = "none";
                const {bbox, baseline, translatedText} = block;
                box.style.setProperty("--pos-x", `${(bbox.x0 / baseWidth) * 100}%`),
                box.style.setProperty("--pos-y", `${(bbox.y0 / baseHeight) * 100}%`),
                box.style.setProperty("--box-width", `${((bbox.x1 - bbox.x0) / baseWidth) * 100}%`),
                box.style.setProperty("--box-height", `${((bbox.y1 - bbox.y0) / baseHeight) * 100}%`);
                if (block._cachedStyles) {
                    const s = block._cachedStyles;
                    s.background && (box.style.background = s.background);
                    s.color && (box.style.color = s.color);
                    s.writingMode && (box.style.writingMode = s.writingMode);
                    s.transform && (box.style.transform = s.transform);
                    s.transformOrigin && (box.style.transformOrigin = s.transformOrigin);
                    s.rotation && (box.dataset.rotation = s.rotation);
                } else {
                    this._applyRotationFromBaseline(box, bbox, baseline);
                }
                if (translatedText && "" !== translatedText && "[[ERROR]]" !== translatedText) {
                    const textEl = document.createElement("div");
                    textEl.className = "ocr-box-text", textEl.innerHTML = translatedText, box.appendChild(textEl);
                } else if ("[[ERROR]]" === translatedText) {
                    const btn = document.createElement("button");
                    btn.className = "ocr-retry-btn", btn.textContent = "\u21BB";
                    canvas.ocrTranslator && (btn.onclick = function(e) {
                        e.preventDefault(), e.stopPropagation(),
                        OCRStrategy.retryOcrBoxTranslation(canvas, i, canvas.ocrTranslator);
                    });
                    box.appendChild(btn), box.classList.add("ocr-box-error");
                }
                fragment.appendChild(box);
                createdBoxes.push({ box: box, block: block, bbox: bbox, index: i });
            });
            container.appendChild(fragment);
            if (boxesVisible) {
                createdBoxes.forEach(({ box, block, bbox, index }) => {
                    if (!block._cachedStyles) {
                        OCRStrategy.calculateBoxColor(block, canvas, null, bbox, box, index);
                    }
                    try { OCRStrategy.adjustFontSize(box); } catch (e) {}
                });
            }
            if (!container._lazyDragInit) {
                container._lazyDragInit = !0;
                container.addEventListener("pointerdown", function(e) {
                    const box = e.target.closest(".ocr-box");
                    if (box && !OCRStrategy._initializedBoxes.has(box)) {
                        OCRStrategy.initSingleBoxDragResize(box, box.parentElement, canvas, null);
                    }
                });
            }
            delete container._translationCache;
        }
        static enableDownloadButton() {
            document.getElementById("downloadPdf").disabled = !1;
        }
        static disableDownloadButton() {
            document.getElementById("downloadPdf").disabled = !0;
        }
    }
    class ImageUIManager extends BaseUIManager {
        constructor() {
            super();
        }
        initUI() {
            this.created || (super.initUI(), this._loadBase64Image(), document.getElementById("downloadPdf").addEventListener("click", this.exportImageCallback.bind(this)));
        }
        removeUI(duration) {
            this.removed || (super.removeUI(duration), ImageUIManager.enableDownloadButton());
        }
        static enableDownloadButton() {
            document.getElementById("downloadPdf").disabled = !1;
        }
        static disableDownloadButton() {
            document.getElementById("downloadPdf").disabled = !0;
        }
        exportImageCallback() {
            const options = {
                quality: 1
            }, exporter = new ImageExporterFacade, exportCommand = new ExportImageCommand(exporter);
            try {
                exportCommand.execute(options, BaseUIManager.showNotification);
            } catch (error) {
                BaseUIManager.showNotification(error, "error");
            }
        }
        _loadBase64Image() {
            try {
                const imgElement = document.getElementById("base64Image"), base64String = `data:image/${fileType};base64,${base64Data.data}`;
                imgElement.src = base64String, imgElement.alt = fileName, ImmUtils.observeCanvasResize(imgElement);
            } catch (error) {}
        }
    }
    class UIManagerFactory {
        static createUIManager(type) {
            switch (type) {
              case "pdf":
                return new PDFUIManager;

              case "image":
                return new ImageUIManager;

              case "page":
                return new PageUIManager;

              case "hidden":
                return new HiddenUIManager;

              default:
                return new BaseUIManager;
            }
        }
    }
    class OCREngine {
        async recognize(element, options) {
            throw new Error("Metodo recognize() non implementato in OCREngine");
        }
        async initEngine() {
            throw new Error("Metodo initEngine() non implementato in OCREngine");
        }
        async terminateEngine() {
            throw new Error("Metodo terminateEngine() non implementato in OCREngine");
        }
    }
    function createTesseractMainThreadShim(blobUrl, blob) {
        console.warn("Tesseract: CSP blocked Worker, using main-thread shim");
        const channel = new MessageChannel();
        const workerPort = channel.port1, callerPort = channel.port2;
        const pendingMessages = [];
        let ready = false;
        const fakeBase = {
            onmessage: null,
            _msgListeners: [],
            postMessage: function(data, transfer) { workerPort.postMessage(data, transfer || []); },
            addEventListener: function(type, fn) {
                if (type === "message") fakeBase._msgListeners.push(fn);
            },
            removeEventListener: function(type, fn) {
                if (type === "message") fakeBase._msgListeners = fakeBase._msgListeners.filter(function(f) { return f !== fn; });
            }
        };
        var fakeSelf = typeof Proxy !== "undefined" ? new Proxy(fakeBase, {
            get: function(t, p) { if (p === "self") return fakeSelf; return p in t ? t[p] : window[p]; },
            set: function(t, p, v) { t[p] = v; return true; }
        }) : fakeBase;
        if (!("Proxy" in window)) fakeBase.self = fakeBase;
        function shimAddEventListener(type, fn) {
            if (type === "message") fakeBase._msgListeners.push(fn);
        }
        function shimRemoveEventListener(type, fn) {
            if (type === "message") fakeBase._msgListeners = fakeBase._msgListeners.filter(function(f) { return f !== fn; });
        }
        var _importCache = {};
        function shimImportScripts() {
            for (var i = 0; i < arguments.length; i++) {
                try {
                    var url = arguments[i];
                    var code = _importCache[url];
                    if (!code) {
                        console.warn("[TessShim] importScripts sync XHR fallback:", url);
                        var xhr = new XMLHttpRequest();
                        xhr.open("GET", url, false);
                        xhr.send();
                        if (xhr.status >= 200 && xhr.status < 300) code = xhr.responseText;
                    }
                    if (code) (0, eval)(code);
                } catch(ex) { console.warn("shimImportScripts failed for:", arguments[i], ex); }
            }
        }
        function dispatchToFake(e) {
            if (typeof fakeSelf.onmessage === "function") fakeSelf.onmessage(e);
            fakeBase._msgListeners.forEach(function(fn) { fn(e); });
        }
        workerPort.onmessage = function(e) {
            if (!ready) { pendingMessages.push(e); return; }
            setTimeout(function() { dispatchToFake(e); }, 0);
        };
        workerPort.start(); callerPort.start();
        (async function() {
            try {
                var blobText = blob ? await blob.text() : await fetch(blobUrl).then(function(r) { return r.text(); });
                var match = blobText.match(/importScripts\s*\(\s*["'](.+?)["']\s*\)/);
                var workerCode;
                if (match) {
                    var resp = await fetch(match[1]);
                    workerCode = await resp.text();
                } else {
                    workerCode = blobText;
                }
                // Pre-fetch WASM core JS files asynchronously so shimImportScripts serves from cache
                var coreUrls = workerCode.match(/https?:\/\/[^"'\s\\)]+tesseract-core[^"'\s\\)]*\.js/g) || [];
                coreUrls = coreUrls.filter(function(v, i, a) { return a.indexOf(v) === i; });
                for (var u = 0; u < coreUrls.length; u++) {
                    try {
                        var pResp = await fetch(coreUrls[u]);
                        if (pResp.ok) _importCache[coreUrls[u]] = await pResp.text();
                    } catch(e) {}
                }
                await new Promise(function(r) { setTimeout(r, 0); });
                var fn = new Function("self", "postMessage", "importScripts", "addEventListener", "removeEventListener", "onmessage", workerCode);
                var _savedOm = window.onmessage;
                var _origWinAEL = window.addEventListener;
                var _origWinREL = window.removeEventListener;
                window.addEventListener = function(type, fn, opts) {
                    if (type === "message") { fakeBase._msgListeners.push(fn); return; }
                    _origWinAEL.call(window, type, fn, opts);
                };
                window.removeEventListener = function(type, fn, opts) {
                    if (type === "message") { fakeBase._msgListeners = fakeBase._msgListeners.filter(function(f) { return f !== fn; }); return; }
                    _origWinREL.call(window, type, fn, opts);
                };
                window.importScripts = shimImportScripts;
                fn(fakeSelf, fakeSelf.postMessage.bind(fakeSelf), shimImportScripts, shimAddEventListener, shimRemoveEventListener, null);
                window.addEventListener = _origWinAEL;
                window.removeEventListener = _origWinREL;
                if (typeof window.onmessage === "function" && window.onmessage !== _savedOm) {
                    fakeBase.onmessage = window.onmessage;
                    window.onmessage = _savedOm;
                }
                ready = true;
                // Flush pending messages with yield between each to avoid blocking the page
                while (pendingMessages.length) {
                    await new Promise(function(r) { setTimeout(r, 0); });
                    if (pendingMessages.length) dispatchToFake(pendingMessages.shift());
                }
            } catch(err) {
                console.error("Tesseract main-thread shim error:", err);
            }
        })();
        var shim = {
            postMessage: function(data, transfer) { callerPort.postMessage(data, transfer || []); },
            addEventListener: function(type, fn) {
                if (type === "message") callerPort.addEventListener("message", fn);
                if (type === "error") callerPort.addEventListener("error", fn);
            },
            removeEventListener: function(type, fn) {
                if (type === "message") callerPort.removeEventListener("message", fn);
                if (type === "error") callerPort.removeEventListener("error", fn);
            },
            terminate: function() { workerPort.close(); callerPort.close(); }
        };
        Object.defineProperty(shim, "onmessage", {
            get: function() { return callerPort.onmessage; },
            set: function(fn) { callerPort.onmessage = fn; }
        });
        Object.defineProperty(shim, "onerror", {
            get: function() { return callerPort.onerror; },
            set: function(fn) { callerPort.onerror = fn; }
        });
        return shim;
    }
    class TesseractAdapter extends OCREngine {
        constructor(languages = "eng", tesseractOptions = null) {
            super(), this.worker = null, this.languages = languages, this.tesseractOptions = tesseractOptions, this.isMainThreadShim = false;
        }
        async initEngine() {
            try {
                this.worker = await Promise.race([
                    Tesseract.createWorker(this.languages),
                    new Promise(function(_, reject) { setTimeout(function() { reject(new Error("Worker CSP timeout")); }, 3000); })
                ]);
            } catch(e) {
                console.warn("Tesseract Worker creation failed, retrying with main-thread shim:", e && e.message || e);
                this.isMainThreadShim = true;
                const OrigWorker = window.Worker;
                const OrigCreateObjectURL = URL.createObjectURL;
                const blobMap = new Map();
                URL.createObjectURL = function(obj) {
                    var url = OrigCreateObjectURL.call(URL, obj);
                    if (obj instanceof Blob) blobMap.set(url, obj);
                    return url;
                };
                window.Worker = function(url) { return createTesseractMainThreadShim(url, blobMap.get(url)); };
                window.Worker.prototype = OrigWorker.prototype;
                try {
                    this.worker = await Tesseract.createWorker(this.languages);
                } finally {
                    window.Worker = OrigWorker;
                    URL.createObjectURL = OrigCreateObjectURL;
                }
            }
            this.tesseractOptions && await this.worker.setParameters(this.tesseractOptions);
        }
        async terminateEngine() {
            this.worker && (await this.worker.terminate(), this.worker = null);
        }
        async recognize(element, options) {
            const extraOptions = {
                ...options,
                lang: this.languages
            };
            return await (this.worker?.recognize(element, extraOptions, {
                blocks: !0
            }));
        }
    }
    class OCRStrategy {
        constructor(adapter, translator) {
            this.adapter = adapter, this.translator = translator, this._overlayUpdateScheduled = !1;
        }
        static debouncedUpdate(e, t, i) {
            OCRStrategy.debounce((element, tempCanvas, iElementData) => {
                OCRStrategy.updateOverlay(element, tempCanvas, iElementData), this._overlayUpdateScheduled = !1;
            }, 100)(e, t, i);
        }
        async process(element) {
            throw new Error("Metodo process() non implementato in OCRStrategy");
        }
        static adjustFontSize(box) {
            const handles = box.querySelectorAll(".resize-handle"), handleDisplays = [];
            handles.forEach(handle => {
                handleDisplays.push(handle.style.display), handle.style.display = "none";
            });
            let fontSize, low = 1e-5, high = 30;
            for (let i = 0; i < 10; i++) fontSize = (low + high) / 2, box.style.fontSize = fontSize + "px", 
            box.scrollHeight <= box.clientHeight ? low = fontSize : high = fontSize;
            box.style.fontSize = low + "px";
            let idx = 0;
            handles.forEach(handle => {
                handle.style.display = handleDisplays[idx++];
            });
        }
        static retryOcrBoxTranslation(img, idx, trFunc) {
            const boxes = Array.from(img.parentElement.querySelectorAll(".ocr-box")), box = boxes.find(b => parseInt(b.getAttribute("data-ocr-index"), 10) === Number(idx));
            if (idx < 0 || idx >= boxes.length) return;
            if (!box) return;
            const dataAttr = box.getAttribute("data-ocr-info");
            if (!dataAttr) return;
            const data = JSON.parse(dataAttr), translator = trFunc || img.ocrTranslator;
            if (!translator) return;
            let zoomFactor, offsetX, offsetY;
            data.translatedText = "", zoomFactor = parseFloat(box.dataset?.lastZoomFactor) || 1, 
            offsetX = parseFloat(box.dataset?.lastOffsetX) || 0, offsetY = parseFloat(box.dataset?.lastOffsetY) || 0, 
            box.setAttribute("data-ocr-info", JSON.stringify(data)), OCRStrategy.updateBoxesInChunks(img, [ box ], offsetX, offsetY, zoomFactor), 
            translator.translateText(data.originalText.replace(/<br>/gi, "[[BR]]")).then(translatedText => {
                const finalText = ImmUtils.decodeHTMLEntities(translatedText).replace(/\[\[BR\]\]/g, "<br>");
                data.translatedText = finalText, box.setAttribute("data-ocr-info", JSON.stringify(data)), 
                OCRStrategy.updateBoxesInChunks(img, [ box ], offsetX, offsetY, zoomFactor);
            }).catch(e => {
                data.translatedText = "[[ERROR]]", box.setAttribute("data-ocr-info", JSON.stringify(data)), 
                OCRStrategy.updateBoxesInChunks(img, [ box ], offsetX, offsetY, zoomFactor);
            });
        }
        static sampleMedianColor(ctx, x, y, width, height) {
            const data = ctx.getImageData(x, y, width, height).data, rValues = [], gValues = [], bValues = [], aValues = [];
            for (let i = 0; i < data.length; i += 4) rValues.push(data[i]), gValues.push(data[i + 1]), 
            bValues.push(data[i + 2]), aValues.push(data[i + 3]);
            function median(values) {
                values.sort((a, b) => a - b);
                const mid = Math.floor(values.length / 2);
                return values.length % 2 == 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
            }
            return {
                r: median(rValues),
                g: median(gValues),
                b: median(bValues),
                a: median(aValues)
            };
        }
        static getCtxFromElement(el, corsFreeCanvas = null) {
            return el ? corsFreeCanvas ? corsFreeCanvas.getContext("2d") : "function" == typeof el.getContext ? el.getContext("2d") : null : null;
        }
        static updateBoxesInChunks(element, boxes, offsetX = 0, offsetY = 0, zoomFactor = 1, corsFreeCanvas, lastTranslatedIndex, translator = null) {
            const currTranslator = translator || element.ocrTranslator;
            const baseW = element.ocrBaseWidth || element.width, baseH = element.ocrBaseHeight || element.height;
            if (1 === boxes.length) {
                let b = boxes[0];
                const data = b?.getAttribute("data-ocr-info");
                if (data) {
                    const d = JSON.parse(data);
                    setTimeout(() => updateBox(b, d, 0), 50);
                }
                return;
            }
            if (null != lastTranslatedIndex && lastTranslatedIndex >= 0 && lastTranslatedIndex < boxes.length) {
                let b = boxes[lastTranslatedIndex];
                const data = b?.getAttribute("data-ocr-info");
                if (data) {
                    const d = JSON.parse(data);
                    setTimeout(() => updateBox(b, d, lastTranslatedIndex), 50);
                }
                return;
            }
            let currentIndex = 0;
            function updateBox(box, data, boxIndex) {
                if (!box || !box.parentElement || ImmUtils.isCancelled()) return;
                const html = box.innerHTML.trim(), {bbox: bbox, translatedText: translatedText, baseline: baseline} = data;
                const xPct = (bbox.x0 / baseW) * 100, yPct = (bbox.y0 / baseH) * 100,
                    wPct = ((bbox.x1 - bbox.x0) / baseW) * 100, hPct = ((bbox.y1 - bbox.y0) / baseH) * 100;
                if (box.dataset.lastOffsetX = offsetX, box.dataset.lastOffsetY = offsetY,
                box.dataset.lastZoomFactor = zoomFactor, requestAnimationFrame(() => {
                    box.style.setProperty("--pos-x", `${xPct}%`), box.style.setProperty("--pos-y", `${yPct}%`),
                    box.style.setProperty("--box-width", `${wPct}%`), box.style.setProperty("--box-height", `${hPct}%`),
                    box.style.setProperty("--zoom-factor", `${zoomFactor}`), box.style.setProperty("--offset-x", `${offsetX}px`),
                    box.style.setProperty("--offset-y", `${offsetY}px`);
                }), -1 === boxIndex && (html.includes('class="spinner"') || html.includes("ocr-retry-btn"))) return;
                if (translatedText && "" !== translatedText) if ("[[ERROR]]" === translatedText) {
                    box.querySelectorAll(":scope > .spinner, :scope > .ocr-retry-btn, :scope > .ocr-box-text").forEach(el => el.remove());
                    const btn = document.createElement("button");
                    btn.className = "ocr-retry-btn", btn.textContent = "↻", currTranslator && (btn.onclick = function(e) {
                        e.preventDefault(), e.stopPropagation(), OCRStrategy.retryOcrBoxTranslation(element, box.dataset.index, currTranslator);
                    }), box.appendChild(btn), box.classList.add("ocr-box-error"),
                    box.contentEditable = "false";
                } else if (box.querySelector(":scope > .ocr-box-text")) box.querySelector(":scope > .ocr-box-text").innerHTML = translatedText, 
                box.querySelectorAll(":scope > .spinner, :scope > .ocr-retry-btn").forEach(el => el.remove()), 
                box.classList.remove("ocr-box-error"), OCRStrategy.calculateBoxColor(data, element, corsFreeCanvas, bbox, box, parseInt(box.dataset.index)); else {
                    box.querySelectorAll(":scope > .spinner, :scope > .ocr-retry-btn").forEach(el => el.remove());
                    const textEl = document.createElement("div");
                    textEl.className = "ocr-box-text", textEl.innerHTML = translatedText, box.appendChild(textEl), 
                    box.classList.remove("ocr-box-error"), OCRStrategy.calculateBoxColor(data, element, corsFreeCanvas, bbox, box, parseInt(box.dataset.index));
                } else {
                    box.querySelectorAll(":scope > .spinner, :scope > .ocr-retry-btn, :scope > .ocr-box-text").forEach(el => el.remove());
                    const spinner = document.createElement("div");
                    spinner.className = "spinner", box.appendChild(spinner), box.classList.remove("ocr-box-error"),
                    box.contentEditable = "false";
                }
                if (-1 === boxIndex && "" !== html && !html.includes('class="spinner"') && !html.includes("ocr-retry-btn")) {
                    requestAnimationFrame(() => {
                        try { OCRStrategy.adjustFontSize(box); } catch (e) {}
                    });
                    return;
                }
                let angleDeg = 0, isVertical = !1, dx = 0, dy = 0;
                if (baseline && void 0 !== baseline.x0 && void 0 !== baseline.y0 && void 0 !== baseline.x1 && void 0 !== baseline.y1 && bbox) {
                    dx = baseline.x1 - baseline.x0, dy = baseline.y1 - baseline.y0;
                    const threshold = Math.sqrt(dx * dx + dy * dy) * Math.cos(80 * Math.PI / 180);
                    if (Math.abs(dx) < threshold) {
                        const bw = bbox.x1 - bbox.x0;
                        isVertical = !0, bbox.y1 - bbox.y0 < 1.5 * bw && (angleDeg = Math.atan2(dy, dx) * (180 / Math.PI), 
                        angleDeg > 90 ? angleDeg -= 180 : angleDeg < -90 && (angleDeg += 180));
                    } else angleDeg = Math.atan2(dy, dx) * (180 / Math.PI), angleDeg > 90 ? angleDeg -= 180 : angleDeg < -90 && (angleDeg += 180);
                }
                let rotationTransform = "";
                isVertical ? 90 != angleDeg && -90 != angleDeg ? (box.style.writingMode = "vertical-rl", 
                box.style.transformOrigin = "center center") : (box.style.transformOrigin = "bottom left", 
                rotationTransform = dy < 0 ? `rotate(${angleDeg}deg) scaleX(1)` : "") : (rotationTransform = `rotate(${angleDeg}deg)`, 
                box.style.transformOrigin = "top left"), requestAnimationFrame(() => {
                    box.dataset.rotation = angleDeg, box.style.transform = `${rotationTransform}`;
                });
                try {
                    OCRStrategy.adjustFontSize(box);
                } catch (e) {}
            }
            requestAnimationFrame(function updateChunk() {
                if (ImmUtils.isCancelled()) return;
                for (let j = 0; j < 5 && currentIndex < boxes.length; j++, currentIndex++) {
                    let b = boxes[currentIndex];
                    const d = b?.getAttribute("data-ocr-info");
                    if (!d) continue;
                    updateBox(b, JSON.parse(d), -1);
                }
                currentIndex < boxes.length && !ImmUtils.isCancelled() && setTimeout(updateChunk, 50);
            });
        }
        static updateOverlay(element, corsFreeCanvas = null, iElementData = null, translator = null) {
            const container = element.parentElement;
            if (!container) return;
            if (!element.ocrData) {
                const boxes = Array.from(container.querySelectorAll(".ocr-box")).sort((a, b) => parseInt(a.getAttribute("data-ocr-index"), 10) - parseInt(b.getAttribute("data-ocr-index"), 10));
                if (0 === boxes.length) return;
                const canvasRect = element.getBoundingClientRect(), containerRect = container.getBoundingClientRect(), baseWidth = element.ocrBaseWidth || canvasRect.width;
                let zoomFactor = canvasRect.width / baseWidth;
                const offsetX = canvasRect.left - containerRect.left, offsetY = canvasRect.top - containerRect.top;
                let lastTranslatedIndex = -1;
                return iElementData >= 0 && (lastTranslatedIndex = iElementData), OCRStrategy.enableDragResizeForBoxes(element, corsFreeCanvas),
                void OCRStrategy.updateBoxesInChunks(element, boxes, offsetX, offsetY, zoomFactor, corsFreeCanvas, lastTranslatedIndex, translator);
            }
            const canvasRect = element.getBoundingClientRect(), containerRect = container.getBoundingClientRect(), baseWidth = element.ocrBaseWidth || canvasRect.width;
            let zoomFactor = canvasRect.width / baseWidth;
            const offsetX = canvasRect.left - containerRect.left, offsetY = canvasRect.top - containerRect.top;
            let boxes = container._ocrBoxes || [];
            if (boxes.length < element.ocrData.length) {
                const fragment = document.createDocumentFragment();
                for (let i = boxes.length; i < element.ocrData.length; i++) {
                    const boxDiv = document.createElement("div");
                    boxDiv.className = "ocr-box", boxDiv.dataset.index = i, boxDiv.setAttribute("data-ocr-index", i), 
                    boxDiv._keydownHandler = function(e) {
                        if ("Backspace" === e.key && "" === boxDiv.innerText.trim()) {
                            e.preventDefault();
                            const idx = parseInt(boxDiv.dataset.index, 10);
                            boxDiv.remove(), element.ocrData && idx >= 0 && idx < element.ocrData.length && (element.ocrData[idx] = null);
                        }
                    }, boxDiv.addEventListener("keydown", boxDiv._keydownHandler), boxDiv._beforeinputHandler = function(e) {
                        if ("deleteContentBackward" === e.inputType && "" === boxDiv.innerText.trim()) {
                            e.preventDefault();
                            const idx = parseInt(boxDiv.dataset.index, 10);
                            boxDiv.remove(), element.ocrData && idx >= 0 && idx < element.ocrData.length && (element.ocrData[idx] = null);
                        }
                    }, boxDiv.addEventListener("beforeinput", boxDiv._beforeinputHandler), boxDiv.setAttribute("data-ocr-info", JSON.stringify(element.ocrData[i])), 
                    fragment.appendChild(boxDiv), boxes.push(boxDiv);
                }
                container.appendChild(fragment);
            }
            if (boxes.length > element.ocrData.length) for (let i = element.ocrData.length; i < boxes.length; i++) boxes[i].remove();
            let lastTranslatedIndex = -1;
            iElementData >= 0 && (lastTranslatedIndex = iElementData), OCRStrategy.updateBoxesInChunks(element, boxes, offsetX, offsetY, zoomFactor, corsFreeCanvas, lastTranslatedIndex, translator), 
            OCRStrategy.enableDragResizeForBoxes(element, corsFreeCanvas), delete element.ocrData, 
            delete container._ocrBoxes;
        }
        static calculateBoxColor(data, img, corsFreeCanvas, bbox, box, currentIndex, force = !1) {
            try {
                if (!data.color || force) {
                    const ctx = OCRStrategy.getCtxFromElement(img, corsFreeCanvas);
                    if (ctx) {
                        const patchX = Math.floor(bbox.x0), patchY = Math.floor(bbox.y0), patchWidth = Math.max(1, Math.floor(bbox.x1 - bbox.x0)), patchHeight = Math.max(1, Math.floor(bbox.y1 - bbox.y0)), avgColor = OCRStrategy.sampleMedianColor(ctx, patchX, patchY, patchWidth, patchHeight);
                        data.color = avgColor, box.setAttribute("data-ocr-info", JSON.stringify(data));
                    }
                }
                if (data.color) {
                    box.style.background = `rgba(${data.color.r}, ${data.color.g}, ${data.color.b}, ${data.color.a / 255})`;
                    const brightness = (299 * data.color.r + 587 * data.color.g + 114 * data.color.b) / 1e3;
                    box.style.color = brightness < 128 ? "#fff" : "#000";
                }
            } catch (error) {}
        }
        static _initializedBoxes=new WeakSet;
        static initSingleBoxDragResize(box, img, cnt, canvas = null) {
            if (OCRStrategy._initializedBoxes.has(box)) return;
            const container = cnt, baseWidth = img.ocrBaseWidth || img.naturalWidth || img.width, containerRect = container.getBoundingClientRect(), imgRect = img.getBoundingClientRect(), offsetX = imgRect.left - containerRect.left, offsetY = imgRect.top - containerRect.top;
            const zoomFactor = imgRect.width / baseWidth;
            OCRStrategy._initBoxHandlers(box, img, canvas, offsetX, offsetY, zoomFactor);
        }
        static enableDragResizeForBoxes(img, canvas = null) {
            const container = img.parentElement, boxes = container.querySelectorAll(".ocr-box"), baseWidth = img.ocrBaseWidth || img.naturalWidth || img.width, containerRect = container.getBoundingClientRect(), imgRect = img.getBoundingClientRect(), offsetX = imgRect.left - containerRect.left, offsetY = imgRect.top - containerRect.top;
            const zoomFactor = imgRect.width / baseWidth;
            boxes.forEach(box => {
                if (OCRStrategy._initializedBoxes.has(box)) return;
                OCRStrategy._initBoxHandlers(box, img, canvas, offsetX, offsetY, zoomFactor);
            });
        }
        static _convertBoxToPercentages(box, img) {
            const parent = box.parentElement;
            if (!parent) return;
            const parentW = parent.clientWidth, parentH = parent.clientHeight;
            if (!parentW || !parentH) return;
            const computed = getComputedStyle(box);
            const left = parseFloat(computed.left) || 0, top = parseFloat(computed.top) || 0,
                width = parseFloat(computed.width) || 0, height = parseFloat(computed.height) || 0;
            box.style.setProperty("--pos-x", `${(left / parentW) * 100}%`);
            box.style.setProperty("--pos-y", `${(top / parentH) * 100}%`);
            box.style.setProperty("--box-width", `${(width / parentW) * 100}%`);
            box.style.setProperty("--box-height", `${(height / parentH) * 100}%`);
        }
        static _initBoxHandlers(box, img, canvas, offsetX, offsetY, zoomFactor) {
            if (OCRStrategy._initializedBoxes.has(box)) return;
                const handles = {};
                [ "top", "right", "bottom", "left" ].forEach(side => {
                    const handle = document.createElement("div");
                    handle.className = "resize-handle " + side, box.appendChild(handle),
                    handles[side] = handle;
                });
                [ "top-left", "top-right", "bottom-right", "bottom-left" ].forEach(corner => {
                    const handle = document.createElement("div");
                    handle.className = "resize-handle " + corner, box.appendChild(handle),
                    handles[corner] = handle;
                });
                let dragStartX, dragStartY, origX, origY, currentDraggingBox = null, isDragging = !1, dragTimer = null, dragStartTime = 0, updatePending = !1;
                function preventDefault(e) {
                    e.preventDefault();
                }
                function onDragStart(e) {
                    if (!(e.target.classList.contains("resize-handle") || box.contains(document.activeElement) && document.activeElement.classList.contains("ocr-box-text"))) {
                        if (box.getElementsByClassName("ocr-box-text").length > 0) {
                            const textElement = box.getElementsByClassName("ocr-box-text")[0];
                            textElement && (textElement.contentEditable = "false");
                        }
                        document.addEventListener("mouseup", onDragEnd), document.addEventListener("touchend", onDragEnd), 
                        dragStartTime = Date.now(), currentDraggingBox = this, dragTimer = setTimeout(() => {
                            isDragging = !0, updatePending = !0, box.classList.add("dragging"),
                            function disableScrollOnContainer() {
                                const pdfContainer = document.getElementById("pdf-container");
                                pdfContainer && (pdfContainer.classList.add("dragging"), pdfContainer.addEventListener("touchmove", preventDefault, {
                                    passive: !1
                                }));
                            }(), document.addEventListener("mousemove", onDrag), document.addEventListener("touchmove", onDrag, {
                                passive: !1
                            }), dragStartX = e.touches ? e.touches[0].clientX : e.clientX, dragStartY = e.touches ? e.touches[0].clientY : e.clientY, 
                            origX = parseFloat(getComputedStyle(box).left) || 0, origY = parseFloat(getComputedStyle(box).top) || 0, 
                            e.preventDefault();
                        }, 300);
                    }
                }
                function onDragEnd(e) {
                    if (dragTimer) {
                        clearTimeout(dragTimer), dragTimer = null, currentDraggingBox && currentDraggingBox.focus();
                        const textElement = currentDraggingBox ? currentDraggingBox.getElementsByClassName("ocr-box-text")[0] : null;
                        textElement && (textElement.contentEditable = "true", textElement.focus());
                    }
                    if (document.removeEventListener("mousemove", onDrag), document.removeEventListener("touchmove", onDrag), 
                    document.removeEventListener("mouseup", onDragEnd), document.removeEventListener("touchend", onDragEnd), 
                    isDragging && currentDraggingBox) {
                        let box = currentDraggingBox;
                        box.classList.remove("dragging"), function enableScrollOnContainer() {
                            const pdfContainer = document.getElementById("pdf-container");
                            pdfContainer && (pdfContainer.classList.remove("dragging"), pdfContainer.removeEventListener("touchmove", preventDefault, {
                                passive: !1
                            }));
                        }(), isDragging = !1, updatePending && (OCRStrategy.updateBoxOcrData(box, offsetX, offsetY, zoomFactor, img, canvas),
                        OCRStrategy._convertBoxToPercentages(box, img), updatePending = !1);
                        let textElement = box.getElementsByClassName("ocr-box-text")[0];
                        textElement && (textElement.contentEditable = "true", textElement.blur()), box.blur(), 
                        e.preventDefault(), e.stopPropagation(), currentDraggingBox = null;
                    } else {
                        let box = currentDraggingBox;
                        if (box) {
                            if (box.focus(), box.getElementsByClassName("ocr-box-text").length > 0) {
                                let textElement = box.getElementsByClassName("ocr-box-text")[0];
                                textElement && (textElement.contentEditable = "true", textElement.focus());
                            }
                            box.style.cursor = "text", currentDraggingBox = null;
                        }
                    }
                }
                function onDrag(e) {
                    if (!isDragging) return;
                    const currentX = e.touches ? e.touches[0].clientX : e.clientX, currentY = e.touches ? e.touches[0].clientY : e.clientY, x = origX + (currentX - dragStartX), y = origY + (currentY - dragStartY);
                    box.style.setProperty("--pos-x", `${x}px`), box.style.setProperty("--pos-y", `${y}px`), 
                    updatePending = !0, e.preventDefault();
                }
                function attachResizeListener(handle, resizeFn) {
                    let resizeStartX, resizeStartY, origWidth, origHeight, origLeft, origTop, isResizing = !1, updateNeeded = !1;
                    function startResize(e) {
                        isResizing = !0, updateNeeded = !1, resizeStartX = e.touches ? e.touches[0].clientX : e.clientX, 
                        resizeStartY = e.touches ? e.touches[0].clientY : e.clientY, origWidth = parseFloat(getComputedStyle(box).width) || box.offsetWidth, 
                        origHeight = parseFloat(getComputedStyle(box).height) || box.offsetHeight, origLeft = parseFloat(getComputedStyle(box).left) || 0, 
                        origTop = parseFloat(getComputedStyle(box).top) || 0, document.addEventListener("mousemove", onResize), 
                        document.addEventListener("touchmove", onResize, {
                            passive: !1
                        }), document.addEventListener("mouseup", endResize), document.addEventListener("touchend", endResize), 
                        e.stopPropagation(), e.preventDefault();
                    }
                    function onResize(e) {
                        if (!isResizing) return;
                        const currentX = e.touches ? e.touches[0].clientX : e.clientX, currentY = e.touches ? e.touches[0].clientY : e.clientY;
                        resizeFn(box, origWidth, origHeight, origLeft, origTop, currentX - resizeStartX, currentY - resizeStartY), 
                        updateNeeded = !0, e.preventDefault();
                    }
                    function endResize(e) {
                        isResizing && (isResizing = !1, document.removeEventListener("mousemove", onResize), 
                        document.removeEventListener("touchmove", onResize), document.removeEventListener("mouseup", endResize), 
                        document.removeEventListener("touchend", endResize), updateNeeded && (OCRStrategy.updateBoxOcrData(box, offsetX, offsetY, zoomFactor, img, canvas, !0),
                        OCRStrategy._convertBoxToPercentages(box, img), updateNeeded = !1));
                    }
                    handle._resizeHandlers && (document.removeEventListener("mousemove", handle._resizeHandlers.mousemove), 
                    document.removeEventListener("touchmove", handle._resizeHandlers.touchmove), document.removeEventListener("mouseup", handle._resizeHandlers.mouseup), 
                    document.removeEventListener("touchend", handle._resizeHandlers.touchend)), handle.addEventListener("mousedown", startResize), 
                    handle.addEventListener("touchstart", startResize);
                }
                box.addEventListener("mousedown", onDragStart), box.addEventListener("touchstart", onDragStart, {
                    passive: !1
                }), box._dragHandlers = {
                    mousemove: onDrag,
                    touchmove: onDrag
                }, attachResizeListener(handles.right, function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    const angle = parseFloat(box.dataset.rotation) || 0;
                    Math.abs(Math.abs(angle) - 90) < 1 ? box.style.setProperty("--box-height", `${origHeight + diffX}px`) : box.style.setProperty("--box-width", `${origWidth + diffX}px`), 
                    OCRStrategy.adjustFontSize(box);
                }), attachResizeListener(handles.left, function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    const angle = parseFloat(box.dataset.rotation) || 0;
                    Math.abs(Math.abs(angle) - 90) < 1 ? (box.style.setProperty("--box-height", origHeight - diffX + "px"), 
                    box.style.setProperty("--pos-y", `${origTop + diffX}px`)) : (box.style.setProperty("--box-width", origWidth - diffX + "px"), 
                    box.style.setProperty("--pos-x", `${origLeft + diffX}px`)), OCRStrategy.adjustFontSize(box);
                }), attachResizeListener(handles.bottom, function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    const angle = parseFloat(box.dataset.rotation) || 0;
                    Math.abs(Math.abs(angle) - 90) < 1 ? box.style.setProperty("--box-width", `${origWidth + diffY}px`) : box.style.setProperty("--box-height", `${origHeight + diffY}px`), 
                    OCRStrategy.adjustFontSize(box);
                }), attachResizeListener(handles.top, function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    const angle = parseFloat(box.dataset.rotation) || 0;
                    Math.abs(Math.abs(angle) - 90) < 1 ? (box.style.setProperty("--box-width", origWidth - diffY + "px"), 
                    box.style.setProperty("--pos-x", `${origLeft + diffY}px`)) : (box.style.setProperty("--pos-y", `${origTop + diffY}px`), 
                    box.style.setProperty("--box-height", origHeight - diffY + "px")), OCRStrategy.adjustFontSize(box);
                }), attachResizeListener(handles["top-left"], function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.setProperty("--pos-x", `${origLeft + diffX}px`), box.style.setProperty("--pos-y", `${origTop + diffY}px`), 
                    box.style.setProperty("--box-width", origWidth - diffX + "px"), box.style.setProperty("--box-height", origHeight - diffY + "px"), 
                    OCRStrategy.adjustFontSize(box);
                }), attachResizeListener(handles["top-right"], function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.setProperty("--box-height", origHeight - diffY + "px"), box.style.setProperty("--box-width", `${origWidth + diffX}px`), 
                    box.style.setProperty("--pos-y", `${origTop + diffY}px`), OCRStrategy.adjustFontSize(box);
                }), attachResizeListener(handles["bottom-right"], function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.setProperty("--box-width", `${origWidth + diffX}px`), box.style.setProperty("--box-height", `${origHeight + diffY}px`), 
                    OCRStrategy.adjustFontSize(box);
                }), attachResizeListener(handles["bottom-left"], function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.setProperty("--box-width", origWidth - diffX + "px"), box.style.setProperty("--box-height", `${origHeight + diffY}px`), 
                    box.style.setProperty("--pos-x", `${origLeft + diffX}px`), OCRStrategy.adjustFontSize(box);
                }), OCRStrategy._initializedBoxes.add(box);
        }
        static updateBoxOcrData(box, offsetX, offsetY, zoomFactor, img, canvas = null, color = !1) {
            const computed = getComputedStyle(box), newLeft = parseFloat(computed.left), newTop = parseFloat(computed.top), newWidth = parseFloat(computed.width), newHeight = parseFloat(computed.height);
            box.dataset.hasCustomPosition = "true";
            const originalOffsetX = parseFloat(computed.getPropertyValue("--offset-x")) || parseFloat(box.dataset.lastOffsetX) || offsetX, originalOffsetY = parseFloat(computed.getPropertyValue("--offset-y")) || parseFloat(box.dataset.lastOffsetY) || offsetY, originalZoomFactor = parseFloat(computed.getPropertyValue("--zoom-factor")) || parseFloat(box.dataset.lastZoomFactor) || zoomFactor, relativeX = (newLeft - originalOffsetX) / originalZoomFactor, relativeY = (newTop - originalOffsetY) / originalZoomFactor, relativeWidth = newWidth / originalZoomFactor, relativeHeight = newHeight / originalZoomFactor;
            box.dataset.customRelativeX = relativeX, box.dataset.customRelativeY = relativeY, 
            box.dataset.customRelativeWidth = relativeWidth, box.dataset.customRelativeHeight = relativeHeight, 
            box.dataset.lastOffsetX = offsetX, box.dataset.lastOffsetY = offsetY, box.dataset.lastZoomFactor = zoomFactor;
            const newX0 = relativeX, newY0 = relativeY, newX1 = relativeX + relativeWidth, newY1 = relativeY + relativeHeight, index = parseInt(box.dataset.index, 10), dataStr = box.getAttribute("data-ocr-info");
            if (dataStr) {
                let ocrData = JSON.parse(dataStr);
                ocrData.bbox = {
                    x0: newX0,
                    y0: newY0,
                    x1: newX1,
                    y1: newY1
                }, box.setAttribute("data-ocr-info", JSON.stringify(ocrData)), color && OCRStrategy.calculateBoxColor(ocrData, img, canvas, ocrData.bbox, box, index, color);
            }
        }
        static groupOcrData(ocrData, eps = 20, minPts = 2) {
            if (!ocrData || !Array.isArray(ocrData) || 0 === ocrData.length) return [];
            function med(arr) {
                const s = arr.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
                return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
            }
            // === xycut_plus with Y-padding for text lines ===
            const N = ocrData.length;
            const allH = ocrData.map(d => d.bbox.y1 - d.bbox.y0);
            const medianH = med(allH) || 1;
            const yPad = Math.ceil(medianH * 0.25);
            // Flat int arrays: [x0,y0,x1,y1] per box. bx=raw, by=Y-padded
            const bx = new Int32Array(N * 4), by = new Int32Array(N * 4);
            for (let i = 0; i < N; i++) {
                const b = ocrData[i].bbox, o = i * 4;
                bx[o] = Math.floor(b.x0); bx[o+1] = Math.floor(b.y0);
                bx[o+2] = Math.ceil(b.x1); bx[o+3] = Math.ceil(b.y1);
                by[o] = bx[o]; by[o+1] = Math.max(0, bx[o+1] - yPad);
                by[o+2] = bx[o+2]; by[o+3] = bx[o+3] + yPad;
            }
            // Projection histogram along axis (0=X, 1=Y)
            function proj(indices, arr, axis) {
                let mx = 0;
                for (let i = 0; i < indices.length; i++) {
                    const e = arr[indices[i] * 4 + (axis === 0 ? 2 : 3)];
                    if (e > mx) mx = e;
                }
                if (mx <= 0) return null;
                const h = new Int32Array(mx + 1);
                for (let i = 0; i < indices.length; i++) {
                    const o = indices[i] * 4;
                    const s = arr[o + (axis === 0 ? 0 : 1)], e = arr[o + (axis === 0 ? 2 : 3)];
                    for (let p = s; p < e; p++) h[p]++;
                }
                return h;
            }
            // Split profile at valleys — uses adaptive density threshold
            // minGap: minimum width of a valley to count as a split
            // densityRatio: a valley pixel counts as "empty" if value <= peak * densityRatio
            function splitProf(h, minGap, densityRatio) {
                if (!h) return null;
                const dr = densityRatio || 0;
                // Find peak density
                let peak = 0;
                for (let i = 0; i < h.length; i++) if (h[i] > peak) peak = h[i];
                const threshold = Math.floor(peak * dr);
                // Collect all "active" indices (above threshold)
                const a = [];
                for (let i = 0; i < h.length; i++) if (h[i] > threshold) a.push(i);
                if (a.length === 0) return null;
                const starts = [a[0]], ends = [];
                for (let i = 1; i < a.length; i++) {
                    if (a[i] - a[i - 1] > minGap) { ends.push(a[i - 1] + 1); starts.push(a[i]); }
                }
                ends.push(a[a.length - 1] + 1);
                return { s: starts, e: ends };
            }
            // Filter indices by interval on axis
            function filt(indices, arr, axis, s, e) {
                const r = [];
                for (let i = 0; i < indices.length; i++) {
                    const v = arr[indices[i] * 4 + (axis === 0 ? 0 : 1)];
                    if (v >= s && v < e) r.push(indices[i]);
                }
                return r;
            }
            // Sort indices by axis
            function srt(indices, arr, axis) {
                const off = axis === 0 ? 0 : 1;
                return indices.slice().sort((a, b) => arr[a * 4 + off] - arr[b * 4 + off]);
            }
            // recursive_yx_cut: Y first (padded), then X (raw) — for vertical text
            function recYX(indices, res, mg, depth) {
                if (indices.length === 0) return;
                depth = depth || 0;
                const ys = srt(indices, by, 1);
                const yp = splitProf(proj(ys, by, 1), 1, 0);
                if (!yp) return;
                for (let r = 0; r < yp.s.length; r++) {
                    const yc = filt(ys, by, 1, yp.s[r], yp.e[r]);
                    if (yc.length === 0) continue;
                    const xs = srt(yc, bx, 0);
                    // X-axis: try strict first, then density-aware for column detection
                    let xp = splitProf(proj(xs, bx, 0), mg, 0);
                    if ((!xp || xp.s.length <= 1) && depth === 0 && yc.length > 8) {
                        xp = splitProf(proj(xs, bx, 0), Math.max(1, Math.ceil(medianH * 0.5)), 0.1);
                    }
                    if (!xp) continue;
                    if (xp.s.length <= 1) { res.push(xs); continue; }
                    for (let c = 0; c < xp.s.length; c++) {
                        const xc = filt(xs, bx, 0, xp.s[c], xp.e[c]);
                        if (xc.length > 0) recYX(xc, res, mg, depth + 1);
                    }
                }
            }
            // recursive_xy_cut: X first (raw), then Y (padded) — for horizontal text
            // Uses density-aware splitting on X-axis to detect columns even when
            // a few elements (formulas, footnotes) span the column gap.
            function recXY(indices, res, mg, depth) {
                if (indices.length === 0) return;
                depth = depth || 0;
                const xs = srt(indices, bx, 0);
                // On X-axis: try strict (0), then density-aware (0.1) to catch columns
                // bridged by sparse elements like formulas
                let xp = splitProf(proj(xs, bx, 0), 1, 0);
                if ((!xp || xp.s.length <= 1) && depth === 0 && indices.length > 8) {
                    xp = splitProf(proj(xs, bx, 0), Math.max(1, Math.ceil(medianH * 0.5)), 0.1);
                }
                if (!xp) return;
                for (let c = 0; c < xp.s.length; c++) {
                    const xc = filt(xs, bx, 0, xp.s[c], xp.e[c]);
                    if (xc.length === 0) continue;
                    const ys = srt(xc, by, 1);
                    // Y-axis: strict density (0) — lines within a column are dense
                    const yp = splitProf(proj(ys, by, 1), mg, 0);
                    if (!yp) continue;
                    if (yp.s.length <= 1) { res.push(ys); continue; }
                    for (let r = 0; r < yp.s.length; r++) {
                        const yc = filt(ys, by, 1, yp.s[r], yp.e[r]);
                        if (yc.length > 0) recXY(yc, res, mg, depth + 1);
                    }
                }
            }
            // Group boxes by baseline angle — prevents mixing orientations in XY-cut
            function getAngle(idx) {
                const d = ocrData[idx];
                if (!d.baseline || void 0 === d.baseline.x0 || void 0 === d.baseline.y0 || void 0 === d.baseline.x1 || void 0 === d.baseline.y1) return 0;
                const dx = d.baseline.x1 - d.baseline.x0, dy = d.baseline.y1 - d.baseline.y0;
                if (Math.sqrt(dx * dx + dy * dy) < 1) return 0;
                let a = Math.atan2(dy, dx) * (180 / Math.PI);
                if (a > 90) a -= 180; if (a < -90) a += 180;
                return a;
            }
            const ANG_T = 8; // degrees tolerance for same-angle bucket
            const angGroups = new Map();
            for (let i = 0; i < N; i++) {
                const a = getAngle(i);
                const bucket = Math.abs(a) <= ANG_T ? 0 : Math.abs(a) >= 90 - ANG_T ? 90 : Math.round(a / ANG_T) * ANG_T;
                if (!angGroups.has(bucket)) angGroups.set(bucket, []);
                angGroups.get(bucket).push(i);
            }
            const clusters = [];
            for (const [bucket, idxs] of angGroups) {
                if (idxs.length === 0) continue;
                if (bucket === 0) recXY(idxs, clusters, 1);            // horizontal -> X-first
                else if (Math.abs(bucket) >= 90 - ANG_T) recYX(idxs, clusters, 1); // vertical -> Y-first
                else recYX(idxs, clusters, 1);                          // angled -> Y-first (no columns expected)
            }
            // Fallback
            const assigned = new Set();
            for (let i = 0; i < clusters.length; i++) for (let j = 0; j < clusters[i].length; j++) assigned.add(clusters[i][j]);
            for (let i = 0; i < N; i++) if (!assigned.has(i)) clusters.push([i]);
            return clusters.filter(c => c.length > 0).map(clusterIndices => {
                const items = clusterIndices.map(i => ocrData[i]);
                items.sort((a, b) => a.bbox.y0 !== b.bbox.y0 ? a.bbox.y0 - b.bbox.y0 : a.bbox.x0 - b.bbox.x0);
                const x0 = Math.min(...items.map(d => d.bbox.x0)), y0 = Math.min(...items.map(d => d.bbox.y0)), x1 = Math.max(...items.map(d => d.bbox.x1)), y1 = Math.max(...items.map(d => d.bbox.y1)), aggregatedText = items.map(d => d.text).join(" "), baselines = items.map(d => d.baseline).filter(b => b);
                return {
                    bbox: { x0: x0, y0: y0, x1: x1, y1: y1 },
                    baseline: {
                        x0: med(baselines.map(b => b.x0)),
                        y0: med(baselines.map(b => b.y0)),
                        x1: med(baselines.map(b => b.x1)),
                        y1: med(baselines.map(b => b.y1))
                    },
                    originalText: aggregatedText,
                    translatedText: ""
                };
            });
        }
        static debugXYCut(ocrData, containerEl) {
            if (!ocrData || !ocrData.length) { console.log("No ocrData to debug"); return; }
            const colors = ["#e6194b","#3cb44b","#ffe119","#4363d8","#f58231","#911eb4","#42d4f4","#f032e6","#bfef45","#fabebe","#469990","#e6beff","#9A6324","#800000","#aaffc3","#808000","#ffd8b1","#000075","#a9a9a9","#00ff80","#ff69b4","#7b68ee"];
            // Run groupOcrData to get clusters
            const result = OCRStrategy.groupOcrData(ocrData);
            console.group("%c[XY-Cut Debug] " + result.length + " clusters from " + ocrData.length + " boxes", "font-weight:bold;font-size:14px");
            // Log raw input boxes
            console.log("Input boxes:", ocrData.map((d, i) => ({
                i: i, text: d.text.substring(0, 40), x0: Math.round(d.bbox.x0), y0: Math.round(d.bbox.y0), x1: Math.round(d.bbox.x1), y1: Math.round(d.bbox.y1)
            })));
            // Log each cluster
            result.forEach((cl, ci) => {
                const c = colors[ci % colors.length];
                const txt = cl.originalText.substring(0, 80);
                console.log("%cCluster " + ci + " (" + txt + "...)", "color:" + c + ";font-weight:bold",
                    "\n  bbox:", JSON.stringify(cl.bbox),
                    "\n  items:", cl.originalText.split(" ").length + " words");
            });
            // Draw visual overlay
            if (containerEl) {
                containerEl.querySelectorAll(".xycut-debug-overlay").forEach(e => e.remove());
                const canvas = containerEl.querySelector("canvas") || containerEl.querySelector("img");
                if (canvas) {
                    const baseW = canvas.ocrBaseWidth || canvas.width || canvas.naturalWidth;
                    const baseH = canvas.ocrBaseHeight || canvas.height || canvas.naturalHeight;
                    const rect = canvas.getBoundingClientRect();
                    const cRect = containerEl.getBoundingClientRect();
                    const sx = rect.width / baseW, sy = rect.height / baseH;
                    const ox = rect.left - cRect.left, oy = rect.top - cRect.top;
                    result.forEach((cl, ci) => {
                        const c = colors[ci % colors.length];
                        const div = document.createElement("div");
                        div.className = "xycut-debug-overlay";
                        div.style.cssText = "position:absolute;pointer-events:none;z-index:99999;border:2px solid " + c + ";background:" + c + "22;";
                        div.style.left = (ox + cl.bbox.x0 * sx) + "px";
                        div.style.top = (oy + cl.bbox.y0 * sy) + "px";
                        div.style.width = ((cl.bbox.x1 - cl.bbox.x0) * sx) + "px";
                        div.style.height = ((cl.bbox.y1 - cl.bbox.y0) * sy) + "px";
                        const label = document.createElement("span");
                        label.style.cssText = "position:absolute;top:-16px;left:0;font-size:11px;color:" + c + ";font-weight:bold;font-family:monospace;text-shadow:0 0 3px #000,0 0 3px #000;";
                        label.textContent = "#" + ci;
                        div.appendChild(label);
                        containerEl.appendChild(div);
                    });
                    console.log("%cOverlays drawn on container. Call window.__xycutDebugClear() to remove.", "color:gray;font-style:italic");
                }
            }
            // Log X projection for detecting column issues
            const allH = ocrData.map(d => d.bbox.y1 - d.bbox.y0);
            const mH = allH.slice().sort((a,b)=>a-b); const medH = mH[Math.floor(mH.length/2)] || 1;
            console.log("medianH:", Math.round(medH), "yPad:", Math.ceil(medH * 0.25));
            const maxX = Math.ceil(Math.max(...ocrData.map(d => d.bbox.x1)));
            const xProj = new Int32Array(maxX + 1);
            ocrData.forEach(d => { for (let p = Math.floor(d.bbox.x0); p < Math.ceil(d.bbox.x1); p++) xProj[p]++; });
            // Find X valleys (zeros)
            const xValleys = [];
            let inValley = false, vs = 0;
            for (let i = 0; i <= maxX; i++) {
                if (xProj[i] === 0 && !inValley) { inValley = true; vs = i; }
                else if (xProj[i] > 0 && inValley) { inValley = false; if (i - vs > 1) xValleys.push({ start: vs, end: i, width: i - vs }); }
            }
            if (xValleys.length > 0) {
                console.log("X-axis valleys (potential column gaps):", xValleys.sort((a, b) => b.width - a.width).slice(0, 10));
            } else {
                console.log("%cNo X-axis valleys found — boxes overlap horizontally everywhere.", "color:red;font-weight:bold");
                // Find near-zero regions with density-aware threshold
                let peak = 0;
                for (let i = 0; i <= maxX; i++) if (xProj[i] > peak) peak = xProj[i];
                const dThreshold = Math.floor(peak * 0.1);
                console.log("X-projection peak:", peak, "density threshold (10%):", dThreshold);
                const nearValleys = [];
                let inNear = false, ns = 0;
                for (let i = 0; i <= maxX; i++) {
                    if (xProj[i] <= dThreshold && !inNear) { inNear = true; ns = i; }
                    else if (xProj[i] > dThreshold && inNear) { inNear = false; if (i - ns > medH * 0.5) nearValleys.push({ start: ns, end: i, width: i - ns, maxDensity: Math.max(...Array.from(xProj.slice(ns, i))) }); }
                }
                if (nearValleys.length) console.log("Density-aware valleys (10% threshold):", nearValleys.sort((a, b) => b.width - a.width).slice(0, 10));
                else console.log("%cNo density valleys found either — truly single-column layout", "color:orange");
            }
            console.groupEnd();
            return result;
        }
        static debounce(func, wait) {
            let timeout;
            return function(...args) {
                clearTimeout(timeout), timeout = setTimeout(() => func.apply(this, args), wait);
            };
        }
        scheduleOverlayUpdate(element, tempCanvas = null, iElementData = null) {
            this._overlayUpdateScheduled || (this._overlayUpdateScheduled = !0, requestAnimationFrame(() => {
                OCRStrategy.debouncedUpdate(element, tempCanvas, iElementData);
            }));
        }
        static getResultLines(result) {
            if (!result || !result.data || !result.data.blocks) return result.data = {
                lines: []
            }, result;
            const lines = result.data.blocks.map(block => block.paragraphs.map(paragraph => paragraph.lines)).flat(2);
            return result.data.lines = lines, result;
        }
        async _processOcrResult(element, container, tempCanvas, result, groupingThreshold = 20) {
            result.data && result.data.lines || (result = OCRStrategy.getResultLines(result));
            let filteredLines = result.data.lines.filter(line => "" !== line.text.trim());
            if (0 === filteredLines.length) return element.ocrData = [], void (element.dataset.ocrProcessed = "true");
            const rawOcrData = filteredLines.map(line => ({
                bbox: line.bbox,
                baseline: line.baseline,
                translatedText: "",
                text: line.text.trim()
            })), blocks = OCRStrategy.groupOcrData(rawOcrData, groupingThreshold);
            element.ocrData = blocks, "static" === getComputedStyle(container).position && (container.style.position = "relative"), 
            ImmUtils.checkPaused(), ImmUtils.yieldControl(), OCRStrategy.updateOverlay(element, tempCanvas);
            if (!element.parentElement) return void (element.dataset.ocrProcessed = "true");
            const boxes = Array.from(element.parentElement.querySelectorAll(".ocr-box")).sort((a, b) => parseInt(a.getAttribute("data-ocr-index"), 10) - parseInt(b.getAttribute("data-ocr-index"), 10)), translationPromises = blocks.map(block => block.originalText.replace(/<br>/gi, "[[BR]]")).map((text, i) => (async () => {
                const translator = this.translator;
                try {
                    await ImmUtils.checkPaused();
                    const translation = await translator.translateText(text), box = boxes[i];
                    if (!box) return;
                    let data = JSON.parse(box.getAttribute("data-ocr-info"));
                    data.translatedText = ImmUtils.decodeHTMLEntities(translation.trim()).replace(/\[\[BR\]\]/g, "<br>"), 
                    box.setAttribute("data-ocr-info", JSON.stringify(data)), OCRStrategy.updateOverlay(element, tempCanvas, i, translator);
                } catch (e) {
                    const box = boxes[i];
                    if (!box) return;
                    let data = JSON.parse(box.getAttribute("data-ocr-info"));
                    data.translatedText = "[[ERROR]]", box.setAttribute("data-ocr-info", JSON.stringify(data)), 
                    OCRStrategy.updateOverlay(element, tempCanvas, i, translator);
                }
                await ImmUtils.yieldControl();
            })());
            await Promise.all(translationPromises), element.dataset.ocrProcessed = "true";
        }
    }
    class ImageOCRStrategy extends OCRStrategy {
        constructor(adapter, translator) {
            super(adapter, translator);
        }
        async process(img) {
            if (await ImmUtils.checkPaused(), "true" === img.dataset.ocrProcessed) return;
            img.complete || await new Promise(resolve => {
                img.onload = resolve;
            });
            let imageForOCR = img;
            if (!img.crossOrigin || "anonymous" !== img.crossOrigin) try {
                const response = await fetch(img.src), blob = await response.blob(), dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader;
                    reader.onload = () => resolve(reader.result), reader.onerror = reject, reader.readAsDataURL(blob);
                });
                imageForOCR = new Image, imageForOCR.src = dataUrl, await new Promise(resolve => {
                    imageForOCR.onload = resolve;
                });
            } catch (error) {}
            let container = img.parentElement;
            if (!container.classList.contains("ocr-container")) {
                const imgPos = getComputedStyle(img).position;
                "absolute" === imgPos || "fixed" === imgPos
                    ? (container.classList.add("ocr-container"),
                       "static" === getComputedStyle(container).position && (container.style.position = "relative"))
                    : (container = document.createElement("div"),
                       container.classList.add("ocr-container", "ocr-container-inline"), img.parentElement.insertBefore(container, img),
                       container.appendChild(img));
            }
            const originalWidth = imageForOCR.naturalWidth, originalHeight = imageForOCR.naturalHeight;
            img.ocrBaseWidth = originalWidth, img.ocrBaseHeight = originalHeight;
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = originalWidth, tempCanvas.height = originalHeight;
            tempCanvas.getContext("2d").drawImage(imageForOCR, 0, 0, originalWidth, originalHeight), 
            ImmUtils.observeCanvasResize(img);
            const result = await this.adapter.recognize(tempCanvas, {});
            if (!result) throw new Error("Can't process Image OCR");
            return await this._processOcrResult(img, container, tempCanvas, result, 40);
        }
    }
    class PdfPageOCRStrategy extends OCRStrategy {
        constructor(adapter, translator) {
            super(adapter, translator);
        }
        static mapPdfTextToOcrResult(textPage, viewport) {
            if (!textPage || !textPage.items) throw new Error("Contenuto testo PDF non valido");
            return {
                data: {
                    lines: textPage.items.filter(item => item.str && "" !== item.str.trim()).map(item => {
                        const t = pdfjsLib.Util.transform(viewport.transform, item.transform), x = t[4], y = t[5], width = item.width * viewport.scale, bbox = {
                            x0: x,
                            y0: y - item.height * viewport.scale,
                            x1: x + width,
                            y1: y
                        }, baseline = {
                            x0: t[4],
                            y0: t[5],
                            x1: t[4] + t[0] * item.width,
                            y1: t[5] + t[1] * item.width
                        };
                        return {
                            bbox: bbox,
                            text: item.str.replace(/→/g, ""),
                            translatedText: "",
                            baseline: baseline,
                            has_baseline: !0
                        };
                    })
                }
            };
        }
        async process(canvas) {
            if (await ImmUtils.checkPaused(), "true" === canvas.dataset.ocrProcessed) return;
            let container = canvas.parentElement;
            container.classList.contains("ocr-container") || (container = document.createElement("div"),
            container.classList.add("ocr-container", "ocr-container-inline"), canvas.parentElement.insertBefore(container, canvas),
            container.appendChild(canvas));
            const width = canvas.width, height = canvas.height;
            canvas.ocrBaseWidth = width, canvas.ocrBaseHeight = height;
            let result, tempCanvas = null;
            if (canvas.pdfTextContent) {
                if (result = PdfPageOCRStrategy.mapPdfTextToOcrResult(canvas.pdfTextContent.text, canvas.pdfTextContent.viewport),
                !result) throw new Error("PDF Text mapping error");
            } else {
                tempCanvas = document.createElement("canvas");
                tempCanvas.width = width, tempCanvas.height = height;
                tempCanvas.getContext("2d").drawImage(canvas, 0, 0, width, height);
                if (result = await this.adapter.recognize(tempCanvas, {}), !result) throw new Error("PDF OCR error");
            }
            return await this._processOcrResult(canvas, container, tempCanvas, result, 18);
        }
    }
    class OCRManager {
        constructor(ocrWorker, translatorService, type) {
            this.ocrEngine = ocrWorker, this.translatorService = translatorService, this.ocrType = type;
        }
        getOcrEngine() {
            return this.ocrEngine;
        }
        setOcrEngine(ocrEngine) {
            this.ocrEngine = ocrEngine;
        }
        getTranslatorService() {
            return this.translatorService;
        }
        setTranslatorService(translatorService) {
            this.translatorService = translatorService;
        }
        async processContent(element, contentType = null) {
            let ocrStrategy, type = contentType;
            if (type || (type = this.ocrType), "image" === type || "page" === type) ocrStrategy = new ImageOCRStrategy(this.ocrEngine, this.translatorService); else {
                if ("pdf" !== type) throw new Error(`OCR Type not supported: ${type}`);
                ocrStrategy = new PdfPageOCRStrategy(this.ocrEngine, this.translatorService);
            }
            return await ocrStrategy.process(element);
        }
    }
    class BatchRequest {
        constructor(id) {
            this.id = id, this.nodes = [], this.texts = [], this.totalLength = 0, this.status = "pending", 
            this.results = [];
        }
        addNode(node, text) {
            this.nodes.push(node), this.texts.push(text), this.totalLength += text.length;
        }
        canAccommodate(textLength, maxLength) {
            return this.totalLength + textLength <= maxLength;
        }
        isEmpty() {
            return 0 === this.nodes.length;
        }
        getStructuredPayload() {
            return {
                batchId: this.id,
                items: this.texts.map((text, index) => ({
                    id: `item_${index}`,
                    index: index,
                    content: text
                }))
            };
        }
    }
    class NodeRequestManager {
        constructor() {
            this.batchCounter = 0, this.activeRequests = new Map;
        }
        createBatch() {
            return new BatchRequest(`batch_${++this.batchCounter}_${Date.now()}`);
        }
        async processBatchStructured(translationService, batch) {
            try {
                batch.status = "processing", this.activeRequests.set(batch.id, batch);
                const structuredPayload = batch.getStructuredPayload(), batchResults = await translationService.translateBatch(structuredPayload);
                return batch.results = batchResults.map((result, index) => ({
                    index: void 0 !== result.index ? result.index : index,
                    id: result.id || `item_${index}`,
                    original: result.originalText || result.original,
                    translated: result.translatedText || result.translated,
                    status: result.success ? "success" : "error",
                    error: result.error || null
                })), batch.status = "completed", batch.results;
            } catch (error) {
                throw batch.status = "error", error;
            } finally {
                this.activeRequests.delete(batch.id);
            }
        }
        async processBatchWithFallback(translationService, batch) {
            try {
                return await this.processBatchStructured(translationService, batch);
            } catch (error) {
                const results = [];
                for (let i = 0; i < batch.nodes.length; i++) try {
                    const translated = await translationService.translateText(batch.texts[i]);
                    results.push({
                        index: i,
                        id: `item_${i}`,
                        original: batch.texts[i],
                        translated: translated,
                        status: "success"
                    });
                } catch (nodeError) {
                    results.push({
                        index: i,
                        id: `item_${i}`,
                        original: batch.texts[i],
                        translated: null,
                        error: nodeError.message,
                        status: "error"
                    });
                }
                return results;
            }
        }
        cancelAllRequests() {
            for (const [batchId, batch] of this.activeRequests) batch.status = "cancelled";
            this.activeRequests.clear();
        }
        getActiveRequestsCount() {
            return this.activeRequests.size;
        }
    }
    class PageTranslationCore {
        constructor(translationService, uiManager, options) {
            this.uiManager = uiManager, this.translationService = translationService, this.total = 0, 
            this.processed = 0, this.batchNodes = [], this.individualNodes = [], this.punctuationOnlyNodes = [], 
            this.BATCH_MAX_LENGTH = options?.batchMaxLength || 1e3, this.requestManager = new NodeRequestManager, 
            this.nodeToRequest = new WeakMap, this.activeBatches = new Map;
        }
        processPageState(body) {
            ImmUtils.storeOriginalTextNodes();
            const textNodes = ImmUtils.getTextNodes(document.body), processedNodes = [];
            textNodes.forEach(node => {
                if ((!node.parentElement || !node.parentElement.classList.contains("translation-wrapper")) && node.parentNode) {
                    const wrapper = document.createElement("span");
                    if (wrapper.className = "translation-wrapper", node.parentNode.insertBefore(wrapper, node), 
                    wrapper.appendChild(node), !wrapper.querySelector(".text-spinner")) {
                        let spinner = document.createElement("span");
                        spinner.className = "text-spinner", wrapper.appendChild(spinner);
                    }
                }
                const nodeData = this.preprocessNodeForTranslation(node);
                processedNodes.push(nodeData);
            });
            const batchNodes = [], individualNodes = [], punctuationOnlyNodes = [];
            for (const nodeData of processedNodes) 0 === nodeData.cleanText.trim().length ? punctuationOnlyNodes.push(nodeData) : nodeData.cleanText.length > this.BATCH_MAX_LENGTH ? individualNodes.push(nodeData) : batchNodes.push(nodeData);
            return this.total = processedNodes.length, this.batchNodes = batchNodes, this.individualNodes = individualNodes, 
            this.punctuationOnlyNodes = punctuationOnlyNodes, this.total;
        }
        preprocessNodeForTranslation(node) {
            const originalText = node.nodeValue, leadingMatch = originalText.match(/^[\s\p{P}]+/u), trailingMatch = originalText.match(/[\s\p{P}]+$/u), leadingPunctuation = leadingMatch ? leadingMatch[0] : "", trailingPunctuation = trailingMatch ? trailingMatch[0] : "", cleanText = originalText.replace(/^[\s\p{P}]+/u, "").replace(/[\s\p{P}]+$/u, "");
            return {
                node: node,
                originalText: originalText,
                cleanText: cleanText,
                leadingPunctuation: leadingPunctuation,
                trailingPunctuation: trailingPunctuation,
                hasLeadingPunctuation: leadingPunctuation.length > 0,
                hasTrailingPunctuation: trailingPunctuation.length > 0
            };
        }
        applyTranslationWithPunctuation(nodeData, translatedText) {
            let finalText = translatedText;
            return nodeData.hasLeadingPunctuation && (finalText = nodeData.leadingPunctuation + finalText), 
            nodeData.hasTrailingPunctuation && (finalText += nodeData.trailingPunctuation), 
            finalText;
        }
        updateProgress() {
            this.processed += 1, this.uiManager.updateFeedback(`(${this.processed}/${this.total})`);
        }
        static removeSpinner(parent) {
            if (parent) {
                let spinner = parent.querySelector(".text-spinner");
                spinner && parent.removeChild(spinner);
            }
        }
        static addRetryButton(parent, node, retryCallback) {
            if (!parent) return;
            let retryBtn = document.createElement("button");
            retryBtn.className = "text-retry-button", retryBtn.textContent = "↻", retryBtn.onclick = async function() {
                parent.contains(retryBtn) && parent.removeChild(retryBtn);
                let spinnerRetry = document.createElement("span");
                spinnerRetry.className = "text-spinner", parent.appendChild(spinnerRetry);
                try {
                    const retryTranslated = await retryCallback(node.nodeValue);
                    node.nodeValue = retryTranslated, parent.contains(spinnerRetry) && parent.removeChild(spinnerRetry);
                } catch (retryErr) {
                    parent.contains(spinnerRetry) && parent.removeChild(spinnerRetry), parent.appendChild(retryBtn);
                }
            }, parent.appendChild(retryBtn);
        }
        static removeRetryButton(parent) {
            if (parent) {
                let retryBtn = parent.querySelector(".text-retry-button");
                retryBtn && parent.removeChild(retryBtn);
            }
        }
        async processPageNodes() {
            await Promise.all([ this.processBatchNodes(), this.processIndividualNodes(), this.processPunctuationOnlyNodes() ]), 
            ImmUtils.storeOriginalTextNodes();
        }
        async processBatchNodes() {
            if (this.batchNodes.length > 0) try {
                await this.translateNodesBatch();
            } catch (error) {
                await this.translateNodesIndividually();
            }
        }
        async translateNodesIndividually() {
            for (const nodeData of this.batchNodes) {
                await ImmUtils.checkPaused();
                const node = nodeData.node;
                let parent = node.parentElement;
                if (parent) {
                    try {
                        let result = await this.translationService.translateText(nodeData.cleanText);
                        const finalText = this.applyTranslationWithPunctuation(nodeData, result);
                        node.nodeValue = finalText, PageTranslationCore.removeSpinner(parent);
                    } catch (err) {
                        PageTranslationCore.removeSpinner(parent), PageTranslationCore.addRetryButton(parent, node, this.translationService?.translateText?.bind(this.translationService));
                    }
                    this.updateProgress();
                }
            }
        }
        async translateNodesBatch() {
            const batches = this.createStructuredBatches(this.batchNodes);
            for (const batch of batches) await this.processBatchStructured(batch);
        }
        createStructuredBatches(nodeDataArray) {
            const batches = [];
            let currentBatch = this.requestManager.createBatch();
            for (const nodeData of nodeDataArray) {
                const text = nodeData.cleanText;
                currentBatch.canAccommodate(text.length, this.BATCH_MAX_LENGTH) || currentBatch.isEmpty() || (batches.push(currentBatch), 
                currentBatch = this.requestManager.createBatch()), currentBatch.addNode(nodeData, text), 
                this.nodeToRequest.set(nodeData, {
                    batchId: currentBatch.id,
                    nodeIndex: currentBatch.nodes.length - 1
                });
            }
            return currentBatch.isEmpty() || batches.push(currentBatch), batches;
        }
        async processBatchStructured(batch) {
            await ImmUtils.checkPaused();
            try {
                this.activeBatches.set(batch.id, batch);
                const results = await this.requestManager.processBatchWithFallback(this.translationService, batch);
                for (const result of results) {
                    const nodeData = batch.nodes[result.index], node = nodeData.node, parent = node.parentElement;
                    if ("success" === result.status && result.translated) {
                        const decodedTranslation = ImmUtils.decodeHTMLEntities(result.translated), finalText = this.applyTranslationWithPunctuation(nodeData, decodedTranslation);
                        node.nodeValue = finalText, PageTranslationCore.removeSpinner(parent), PageTranslationCore.removeRetryButton(parent);
                    } else PageTranslationCore.removeSpinner(parent), PageTranslationCore.addRetryButton(parent, node, this.translationService?.translateText?.bind(this.translationService));
                    this.updateProgress();
                }
            } catch (error) {
                await this.processBatchNodesIndividually(batch.nodes);
            } finally {
                this.activeBatches.delete(batch.id);
            }
        }
        async processBatchNodesIndividually(nodeDataArray) {
            for (const nodeData of nodeDataArray) {
                await ImmUtils.checkPaused();
                const node = nodeData.node, parent = node.parentElement;
                if (parent) {
                    try {
                        const result = await this.translationService.translateText(nodeData.cleanText), decodedTranslation = ImmUtils.decodeHTMLEntities(result), finalText = this.applyTranslationWithPunctuation(nodeData, decodedTranslation);
                        node.nodeValue = finalText, PageTranslationCore.removeSpinner(parent), PageTranslationCore.removeRetryButton(parent);
                    } catch (err) {
                        PageTranslationCore.removeSpinner(parent), PageTranslationCore.addRetryButton(parent, node, this.translationService?.translateText?.bind(this.translationService));
                    }
                    this.updateProgress();
                }
            }
        }
        async processIndividualNodes() {
            for (const nodeData of this.individualNodes) await ImmUtils.checkPaused(), await this.translateSingleNodeData(nodeData);
        }
        async processPunctuationOnlyNodes() {
            for (const nodeData of this.punctuationOnlyNodes) {
                const parent = nodeData.node.parentElement;
                parent && (PageTranslationCore.removeSpinner(parent), PageTranslationCore.removeRetryButton(parent)), 
                this.updateProgress();
            }
        }
        async translateSingleNodeData(nodeData) {
            const node = nodeData.node;
            let parent = node.parentElement;
            try {
                const translated = await (this.translationService?.translateText(nodeData.cleanText)), finalText = this.applyTranslationWithPunctuation(nodeData, translated);
                node.nodeValue = finalText, this.updateProgress(), PageTranslationCore.removeSpinner(parent);
            } catch (e) {
                PageTranslationCore.removeSpinner(parent), PageTranslationCore.addRetryButton(parent, node, this.translationService?.translateText?.bind(this.translationService));
            }
        }
        getBatchStats() {
            return {
                activeBatches: this.activeBatches.size,
                activeRequests: this.requestManager.getActiveRequestsCount(),
                totalNodes: this.total,
                processedNodes: this.processed,
                batchNodes: this.batchNodes.length,
                individualNodes: this.individualNodes.length,
                punctuationOnlyNodes: this.punctuationOnlyNodes ? this.punctuationOnlyNodes.length : 0
            };
        }
        async cancelAllBatches() {
            this.requestManager.cancelAllRequests(), this.activeBatches.clear();
        }
        getNodeRequestInfo(node) {
            return this.nodeToRequest.get(node);
        }
        logBatchStats() {
            this.getBatchStats();
        }
    }
    class TranslatorApp {
        constructor(options) {
            this.uiManager = UIManagerFactory.createUIManager(options.uiType), this.translationService = new TranslationService(options.translatorOptions, options.translator, options.queueDelay, options?.worker), 
            this.translationService.initWorker(), this.core = new PageTranslationCore(this.translationService, this.uiManager, options.coreSettings), 
            this.ocrManager = new OCRManager(options.ocrWorker, this.translationService, options.uiType);
        }
        async translatePage() {
            try {
                this.uiManager.initUI();
                const total = this.core.processPageState(document.body);
                this.uiManager.updateFeedback(`(0/${total})`, !0), await this.core.processPageNodes();
            } catch (e) {
                BaseUIManager.showNotification(`${e}`, "error");
            }
        }
        async translateImages() {
            try {
                this.uiManager.initUI();
                const images = document.querySelectorAll("img"), total = images.length;
                const ocrEngine = this.ocrManager.getOcrEngine();
                await ocrEngine.initEngine();
                const isShim = ocrEngine.isMainThreadShim;
                if (isShim) {
                    let processed = 0;
                    const toProcess = Array.from(images).filter(img => "true" !== img.dataset.ocrProcessed);
                    const totalToProcess = toProcess.length;
                    if (totalToProcess > 0) {
                        BaseUIManager.showNotification(
                            `Running in compatibility mode (${totalToProcess} image${totalToProcess > 1 ? "s" : ""}). The page may be slow while processing.`,
                            "warning", 1e4
                        );
                    }
                    this.uiManager.updateFeedback(`Image (0/${totalToProcess})`, !0);
                    for (let i = 0; i < toProcess.length; i++) {
                        if (ImmUtils.isCancelled()) {
                            await ocrEngine.terminateEngine();
                            throw new Error("Operation cancelled.");
                        }
                        await ImmUtils.checkPaused();
                        try {
                            await this.ocrManager.processContent(toProcess[i]);
                            processed++;
                        } catch (error) {
                            await ImmUtils.checkPaused();
                        }
                        this.uiManager.updateFeedback(`Image (${processed}/${totalToProcess})`);
                        // Yield to the main thread between images so the browser can repaint and handle user input
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                    await ocrEngine.terminateEngine();
                    return 0;
                }
                const promises = [];
                let processed = 0;
                return images.forEach((img, index) => {
                    "true" !== img.dataset.ocrProcessed && promises.push(Promise.race([ (async () => this.ocrManager.processContent(img).then(() => {
                        processed++, this.uiManager.updateFeedback(`Image (${processed}/${total})`);
                    }).catch(async error => (await ImmUtils.checkPaused(), Promise.resolve())))(), new Promise((_, reject) => {
                        const intervalId = setInterval(async () => {
                            ImmUtils.isCancelled() && (clearInterval(intervalId), await ocrEngine.terminateEngine(),
                            reject(new Error("Operation cancelled.")));
                        }, 50);
                    }) ]));
                }), await Promise.all(promises), await ocrEngine.terminateEngine(),
                0;
            } catch (e) {
                return BaseUIManager.showNotification(`${e}`, "error"), 1;
            }
        }
        async translateLocalImages() {
            try {
                this.uiManager.initUI(), this.uiManager.updateFeedback("(0/1)", !0), await this.translateImages(), 
                this.uiManager.updateFeedback("Done (1/1)", !0);
            } catch (e) {
                BaseUIManager.showNotification(`${e}`, "error");
            }
        }
        async translatePdf() {
            try {
                const module = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@5.0.375/+esm");
                window.pdfjsLib = module, pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.0.375/pdf.worker.mjs",
                this.uiManager.initUI();
                const pdfData = atob(base64Data.data);
                base64Data.data = "", delete base64Data.data;
                if (!document.getElementById("pdf-container")) throw new Error("Elemento con id 'pdf-container' non trovato.");
                const pdfDoc = await pdfjsLib.getDocument({
                    data: pdfData,
                    isEvalSupported: !1,
                    wasmUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.0.375/wasm/"
                }).promise;
                let totalPages = pdfDoc.numPages;
                this.uiManager.updateFeedback(`(0/${totalPages})`, !0);
                await this.ocrManager.getOcrEngine().initEngine();
                this.uiManager.ocrManager = this.ocrManager;
                let pageContainers = await this.uiManager.createPdfPages(pdfDoc);
                if (pageContainers.length !== totalPages) throw new Error("Errore nella creazione delle pagine PDF.");
                const scale = Math.max(window.devicePixelRatio || 1, 2);
                const translator = this.ocrManager.getTranslatorService();
                const renderedIndices = [], otherIndices = [];
                for (let i = 0; i < pageContainers.length; i++) {
                    if ("placeholder" !== pageContainers[i].dataset.pageState) renderedIndices.push(i);
                    else otherIndices.push(i);
                }
                const translationOrder = [...renderedIndices, ...otherIndices];
                let processed = 0;
                const translatePage = async (idx) => {
                    await ImmUtils.checkPaused();
                    const pageNum = idx + 1;
                    const page = await pdfDoc.getPage(pageNum);
                    const textPage = await page.getTextContent();
                    const viewport = page.getViewport({ scale: scale, dontFlip: !1 });
                    if (textPage.items.length > 0) {
                        const ocrResult = PdfPageOCRStrategy.mapPdfTextToOcrResult(textPage, viewport);
                        const filteredLines = ocrResult.data.lines.filter(l => "" !== l.text.trim());
                        if (filteredLines.length > 0) {
                            const rawOcrData = filteredLines.map(line => ({
                                bbox: line.bbox, baseline: line.baseline, translatedText: "", text: line.text.trim()
                            }));
                            const blocks = OCRStrategy.groupOcrData(rawOcrData, 18);
                            const blockTexts = blocks.map(b => b.originalText.replace(/<br>/gi, "[[BR]]"));
                            const translationPromises = blockTexts.map((text, i) => (async () => {
                                try {
                                    await ImmUtils.checkPaused();
                                    const translation = await translator.translateText(text);
                                    blocks[i].translatedText = ImmUtils.decodeHTMLEntities(translation.trim()).replace(/\[\[BR\]\]/g, "<br>");
                                } catch (e) {
                                    blocks[i].translatedText = "[[ERROR]]";
                                }
                            })());
                            await Promise.all(translationPromises);
                            if (ImmUtils.isCancelled()) return;
                            pageContainers[idx]._translationCache = { blocks: blocks };
                            if ("rendered" === pageContainers[idx].dataset.pageState || "translated" === pageContainers[idx].dataset.pageState) {
                                this.uiManager._applyCachedTranslation(pageContainers[idx]);
                            }
                        }
                    } else {
                        const ocrContainer = pageContainers[idx];
                        if ("placeholder" === ocrContainer.dataset.pageState) {
                            this.uiManager._renderingPages.add(pageNum);
                            try {
                                await ProcessPdfPageFacede.renderPage(pdfDoc, pageNum, ocrContainer);
                            } finally {
                                this.uiManager._renderingPages.delete(pageNum);
                            }
                        }
                        if (!ImmUtils.isCancelled() && ("rendered" === ocrContainer.dataset.pageState || "translated" === ocrContainer.dataset.pageState)) {
                            const canvas = ocrContainer.querySelector("canvas");
                            if (canvas) {
                                this.uiManager._renderingPages.add(pageNum);
                                try {
                                    await this.ocrManager.processContent(canvas);
                                    ocrContainer.dataset.pageState = "translated";
                                } catch (error) {
                                    console.error(`OCR error on page ${pageNum}:`, error);
                                } finally {
                                    this.uiManager._renderingPages.delete(pageNum);
                                    this.uiManager._enforceMaxRendered();
                                }
                            }
                        }
                    }
                    page.cleanup();
                    processed++;
                    this.uiManager.updateFeedback(`(${processed}/${totalPages})`);
                    await ImmUtils.yieldControl();
                };
                for (const idx of translationOrder) {
                    if (ImmUtils.isCancelled()) break;
                    await translatePage(idx);
                }
                await this.ocrManager.getOcrEngine().terminateEngine();
                this.uiManager.updateFeedback("Done!", !1);
            } catch (e) {
                BaseUIManager.showNotification(`${e}`, "error");
            }
        }
        async stop(delay = 0) {
            this.uiManager.removeUI(delay);
            if (ImmUtils.isCancelled()) return void this.translationService.stopWorker();
            let hasError = !0;
            for (;hasError; ) {
                hasError = !1;
                document.querySelectorAll(".ocr-box").forEach(box => {
                    const info = box.getAttribute("data-ocr-info");
                    if (!info) return;
                    try { "[[ERROR]]" === JSON.parse(info).translatedText && (hasError = !0); } catch(e) {}
                }), await new Promise(resolve => setTimeout(resolve, 5e3));
            }
            this.translationService.stopWorker();
        }
    }
    async function initConfig(option) {
        return "Microsoft" === option.translator && "" === option.translatorOptions.apiKey && (option.translatorOptions.apiKey = await async function getAzureAuthKey() {
            const options = {
                method: "GET"
            };
            try {
                const response = await fetch("https://edge.microsoft.com/translate/auth", options);
                if (!response.ok) throw new Error("Couldn't get API key! Status: " + response.status);
                return await response.text();
            } catch (err) {
                throw err;
            }
        }()), option;
    }
    class OptionsBuilder {
        constructor() {
            this.options = {
                coreSettings: {},
                translator: null,
                translatorOptions: {},
                queueDelay: 0,
                ocrEngine: null
            };
        }
        setCoreSettings(batchMaxLength = 1e3) {
            return this.options.coreSettings = {
                batchMaxLength: batchMaxLength
            }, this;
        }
        setTranslator(translator) {
            return this.options.translator = translator, this;
        }
        setTranslatorOptions(optionsObj) {
            return this.options.translatorOptions = optionsObj, this;
        }
        setQueueDelay(delay) {
            return this.options.queueDelay = delay, this;
        }
        setOCREngine(ocrLanguages, tessPsm = Tesseract.PSM.AUTO_OSD) {
            return this.options.ocrEngine = new TesseractAdapter(ocrLanguages, {
                tessedit_pageseg_mode: tessPsm
            }), this;
        }
        customize(builderParam) {
            return "fast" === builderParam && (this.options.coreSettings.batchMaxLength = 500, 
            this.options.queueDelay = 500), this;
        }
        build() {
            return this.options;
        }
    }
    class ImmersiveTranslatorCore {
        constructor(config = {}) {
            this.config = this.mergeDefaultConfig(config), this.app = null, this.initialized = !1, 
            this.worker = null;
        }
        mergeDefaultConfig(userConfig) {
            return this.deepMerge({
                translator: "ChatGPT",
                translatorOptions: {
                    apiKey: "",
                    model: "gpt-3.5-turbo",
                    temperature: .3,
                    targetLang: "it",
                    prompt: "Traduci il seguente testo in italiano, mantieni la formattazione:",
                    openAiUrl: "https://api.openai.com/v1/chat/completions"
                },
                queueDelay: 1e3,
                ocrLanguages: "eng",
                coreSettings: {
                    batchMaxLength: 1e3
                },
                ui: {
                    enabled: !0,
                    autoCSS: !0,
                    notifications: !0
                },
                download: !1,
                pdfOCR: !1
            }, userConfig);
        }
        deepMerge(target, source) {
            const result = {
                ...target
            };
            for (const key in source) source[key] && "object" == typeof source[key] && !Array.isArray(source[key]) ? result[key] = this.deepMerge(target[key] || {}, source[key]) : result[key] = source[key];
            return result;
        }
        async init() {
            if (this.initialized) return this;
            try {
                this.worker || await this.initWorker(), download = this.config.download, pdfOCR = this.config.pdfOCR;
                let options = (new OptionsBuilder).setCoreSettings(this.config.coreSettings.batchMaxLength).setTranslator(this.config.translator).setTranslatorOptions(this.config.translatorOptions).setQueueDelay(this.config.queueDelay).setOCREngine(this.config.ocrLanguages).build();
                return options = await initConfig(options), this.app = new TranslatorApp({
                    translator: options.translator,
                    translatorOptions: options.translatorOptions,
                    queueDelay: options.queueDelay,
                    ocrWorker: options.ocrEngine,
                    uiType: "page",
                    coreSettings: options.coreSettings,
                    worker: this.worker
                }), this.initialized = !0, this;
            } catch (error) {
                throw error;
            }
        }
        async initWorker() {
            "undefined" != typeof immTrans && immTrans.worker && (this.worker = immTrans?.worker, 
            await immTrans.ready);
        }
        async translatePage(options = {}) {
            if (await this.init(), !this.app) throw new Error("App non inizializzata");
            this.app.uiType = "page";
            const result = await Promise.all([ this.app.translatePage(), this.app.translateImages() ]);
            return this.config.ui.enabled && (this.app.uiManager.updateFeedback("Done!", !1), 
            this.app.stop(5e3)), result;
        }
        async translateImages(options = {}) {
            if (await this.init(), !this.app) throw new Error("App non inizializzata");
            this.app.uiType = "image";
            const result = await this.app.translateImages();
            return this.config.ui.enabled && (this.app.uiManager.updateFeedback("Done!", !1), 
            this.app.stop(5e3)), result;
        }
        async translateLocalImages(options = {}) {
            if (await this.init(), !this.app) throw new Error("App non inizializzata");
            this.app.uiType = "local";
            const result = await this.app.translateLocalImages();
            return this.config.ui.enabled && (this.app.uiManager.updateFeedback("Done!", !1), 
            this.app.stop(5e3)), result;
        }
        async translatePDF(pdfData = null, options = {}) {
            if (await this.init(), !this.app) throw new Error("App non inizializzata");
            pdfData && ("string" == typeof pdfData ? window.base64Data = pdfData : pdfData instanceof File || pdfData instanceof Blob ? window.base64Data = await this.blobToBase64(pdfData) : pdfData instanceof ArrayBuffer && (window.base64Data = this.arrayBufferToBase64(pdfData))), 
            this.app.uiType = "pdf";
            const result = await this.app.translatePdf();
            return this.config.ui.enabled && this.app.stop(5e3), result;
        }
        async translateText(text, options = {}) {
            if (await this.init(), !this.app || !this.app.core) throw new Error("App non inizializzata");
            return await this.app.core.translationService.translateText(text);
        }
        async translateBatch(texts, options = {}) {
            if (await this.init(), !this.app || !this.app.core) throw new Error("App non inizializzata");
            const batchPayload = {
                batchId: `manual_batch_${Date.now()}`,
                items: texts.map((text, index) => ({
                    id: `item_${index}`,
                    index: index,
                    content: text
                }))
            };
            return await this.app.core.translationService.translateBatch(batchPayload);
        }
        async stop() {
            this.app && await this.app.stop(), this.reset();
        }
        reset() {
            this.initialized = !1, this.app = null, resetAll();
        }
        async blobToBase64(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader;
                reader.onloadend = () => resolve(reader.result.split(",")[1]), reader.onerror = reject, 
                reader.readAsDataURL(blob);
            });
        }
        arrayBufferToBase64(arrayBuffer) {
            const bytes = new Uint8Array(arrayBuffer);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
            return btoa(binary);
        }
        updateConfig(newConfig) {
            this.config = this.deepMerge(this.config, newConfig), this.initialized;
        }
        getConfig() {
            return {
                ...this.config
            };
        }
    }
    async function start(type = "page", downloadValue, pdfOCRValue, options = {}) {
        download = downloadValue, pdfOCR = pdfOCRValue;
        let o = (new OptionsBuilder).setCoreSettings().setTranslator(options?.translator).setTranslatorOptions(options?.translatorOptions).setQueueDelay(options?.queueDelay);
        "hidden" !== type && o.setOCREngine(options?.ocrLanguages), o = o.build();
        try {
            o = await initConfig(o);
        } catch (e) {
            return;
        }
        await immTrans.ready;
        const app = new TranslatorApp({
            translator: o.translator,
            translatorOptions: o.translatorOptions,
            queueDelay: o.queueDelay,
            ocrWorker: o.ocrEngine,
            uiType: type,
            coreSettings: o.coreSettings,
            worker: immTrans?.worker
        });
        switch (type) {
          case "page":
            await Promise.all([ app.translatePage(), app.translateImages() ]), app.uiManager.updateFeedback("Done!", !1), 
            app.stop(5e3);
            break;

          case "image":
            await app.translateLocalImages(), app.uiManager.updateFeedback("Done!", !1), app.stop(5e3);
            break;

          case "pdf":
            await app.translatePdf(), app.stop(5e3);
            break;

          case "hidden":
            await app.translatePage(), app.stop(5e3);
            break;

          default:
            throw new Error("Invalid type");
        }
        resetAll();
    }
    function resetAll() {
        download = !1, pdfOCR = !1, translationPaused = !1, translationCanceled = !1, translationActive = !0, 
        "function" == typeof immTrans?.worker?.terminate && immTrans.worker.terminate();
    }
    window.ImmersiveTranslator = {
        Core: ImmersiveTranslatorCore,
        create: (config = {}) => new ImmersiveTranslatorCore(config),
        async quickStart(type = "page", config = {}) {
            const core = new ImmersiveTranslatorCore(config);
            switch (await core.init(), type) {
              case "page":
                return await core.translatePage();

              case "image":
              case "images":
                return await core.translateImages();

              case "local":
                return await core.translateLocalImages();

              case "pdf":
                return await core.translatePDF();

              default:
                throw new Error(`Tipo non supportato: ${type}`);
            }
        },
        async translateText(text, config = {}) {
            const core = new ImmersiveTranslatorCore(config);
            return await core.translateText(text);
        },
        async translateBatch(texts, config = {}) {
            const core = new ImmersiveTranslatorCore(config);
            return await core.translateBatch(texts);
        },
        presets: {
            minimal: {
                ui: {
                    enabled: !1,
                    autoCSS: !1,
                    notifications: !1
                }
            },
            silent: {
                ui: {
                    enabled: !1,
                    autoCSS: !1,
                    notifications: !1
                },
                queueDelay: 0
            },
            development: {
                translator: "Google",
                translatorOptions: {
                    model: "",
                    temperature: 0
                }
            }
        },
        withPreset: (presetName, additionalConfig = {}) => {
            const preset = window.ImmersiveTranslator.presets[presetName];
            if (!preset) throw new Error(`Preset non trovato: ${presetName}`);
            return (new ImmersiveTranslatorCore).deepMerge(preset, additionalConfig);
        },
        legacyStart: async (type, download, pdfOCR, options) => await start(type, download, pdfOCR, options)
    };
    const namespace = "undefined" != typeof window ? window : "undefined" != typeof self ? self : globalThis;
    namespace.immTrans = namespace.immTrans || {}, namespace.immTrans.start = start,
    namespace.immTrans.resetAll = resetAll;
    // Debug helpers — call from browser console
    window.__xycutDebug = function(pageIndex) {
        const containers = document.querySelectorAll(".ocr-container");
        const idx = pageIndex || 0;
        const container = containers[idx];
        if (!container) { console.log("No container at index", idx, "— total:", containers.length); return; }
        const canvas = container.querySelector("canvas") || container.querySelector("img");
        if (!canvas) { console.log("No canvas/img in container", idx); return; }
        // Rebuild ocrData from existing boxes or pdfTextContent
        let ocrData = null;
        if (canvas.pdfTextContent) {
            const r = PdfPageOCRStrategy.mapPdfTextToOcrResult(canvas.pdfTextContent.text, canvas.pdfTextContent.viewport);
            ocrData = r.data.lines.filter(l => l.text.trim()).map(l => ({ bbox: l.bbox, baseline: l.baseline, text: l.text.trim() }));
        }
        if (!ocrData) {
            const boxes = container.querySelectorAll(".ocr-box");
            if (boxes.length) {
                ocrData = Array.from(boxes).map(b => { try { return JSON.parse(b.getAttribute("data-ocr-info")); } catch(e) { return null; } }).filter(Boolean);
            }
        }
        if (!ocrData || !ocrData.length) { console.log("No OCR data available for page", idx); return; }
        return OCRStrategy.debugXYCut(ocrData, container);
    };
    window.__xycutDebugClear = function() {
        document.querySelectorAll(".xycut-debug-overlay").forEach(e => e.remove());
        console.log("Debug overlays cleared.");
    };
}();