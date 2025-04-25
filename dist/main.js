!function() {
    let download, pdfOCR, translationPaused = !1, translationCanceled = !1, translationActive = !0, originalTextNodes = [], trTextNodes = [];
    const hasNativeUUID = "function" == typeof crypto.randomUUID;
    class ImmUtils {
        static uuidv4_fallback() {
            return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c => {
                const r = 15 & crypto.getRandomValues(new Uint8Array(1))[0];
                return ("x" === c ? r : 3 & r | 8).toString(16);
            }));
        }
        static generateUUID() {
            return hasNativeUUID ? crypto.randomUUID() : ImmUtils.uuidv4_fallback();
        }
        static pauseTranslation() {
            translationPaused = !0;
        }
        static resumeTranslation() {
            translationPaused = !1;
        }
        static cancelTranslation() {
            translationCanceled = !0;
        }
        static translationStatus(isActive) {
            translationActive = isActive;
        }
        static sleep(ms) {
            return new Promise((resolve => setTimeout(resolve, ms)));
        }
        static yieldControl() {
            return new Promise((resolve => requestAnimationFrame(resolve)));
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
            const resizeObserver = new ResizeObserver((() => {
                canvas._observerPaused || OCRStrategy.updateOverlay(canvas);
            }));
            resizeObserver.observe(canvas), window._canvasObservers.set(canvas, resizeObserver);
        }
        static pauseCanvasObserver(canvas) {
            return canvas._observerPaused = !0, !(!window._canvasObservers || !window._canvasObservers.has(canvas)) && (window._canvasObservers.get(canvas).disconnect(), 
            !0);
        }
        static resumeCanvasObserver(canvas) {
            if (window._canvasObservers && window._canvasObservers.has(canvas)) {
                return window._canvasObservers.get(canvas).observe(canvas), setTimeout((() => {
                    canvas._observerPaused = !1;
                }), 50), !0;
            }
            return !1;
        }
        static resetTranslation(notificationCallback = () => {}, feedbackCallback = () => {}) {
            if (translationActive) {
                pdfOCR || ImmUtils.storeTranslationNodes(), feedbackCallback("Reset", !1);
                for (const entry of originalTextNodes) entry.node.nodeValue = entry.text;
                document.querySelectorAll(".ocr-box").forEach((box => {
                    box.style.display = "none";
                })), notificationCallback("Translation Reset", "success"), translationActive = !1;
            } else {
                for (const entry of trTextNodes) entry.text && (entry.node.nodeValue = entry.text);
                document.querySelectorAll(".ocr-box").forEach((box => {
                    box.style.display = "flex", OCRStrategy.adjustFontSize(box);
                })), notificationCallback("Translation Restored", "success"), translationActive = !0;
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
            offscreen.style.position = "fixed", offscreen.style.left = "-9999px", offscreen.style.top = "-9999px", 
            offscreen.style.opacity = "0", document.body.appendChild(offscreen), offscreen.appendChild(clone);
            const rect = box.getBoundingClientRect();
            clone.style.writingMode = "horizontal-tb", clone.style.transform = "none", clone.style.width = rect.height + "px", 
            clone.style.height = rect.width + "px", await new Promise((resolve => requestAnimationFrame(resolve)));
            const dataUrl = (await html2canvas(clone, {
                scale: 2,
                backgroundColor: null
            })).toDataURL("image/png", 1);
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
                const pdfViewer = document.getElementById("pdf-viewer");
                let currentZoomFactor = 1;
                if (pdfViewer && pdfViewer.style.transform) {
                    const match = pdfViewer.style.transform.match(/scale\(([\d.]+)\)/);
                    match && match[1] && (currentZoomFactor = parseFloat(match[1]));
                }
                const firstCanvas = containers[0].querySelector("canvas[data-ocr-processed='true']");
                if (!firstCanvas) throw new Error("No translations found");
                pdfViewer.style.transform = "scale(1)";
                const zoomInButton = document.getElementById("zoomIn"), zoomOutButton = document.getElementById("zoomOut");
                zoomInButton && (zoomInButton.disabled = !0), zoomOutButton && (zoomOutButton.disabled = !0), 
                await ImmUtils.sleep(500);
                const pageWidth = firstCanvas.offsetWidth, pageHeight = firstCanvas.offsetHeight, orientation = pageWidth > pageHeight ? "landscape" : "portrait", {jsPDF: jsPDF} = window.jspdf, pdf = new jsPDF({
                    orientation: orientation,
                    unit: "px",
                    format: [ pageWidth, pageHeight ]
                });
                logFunction("⏳ Processing your PDF ⏳", "success");
                let pagesToProcess = [];
                if ("all" === options.type) pagesToProcess = Array.from({
                    length: containers.length
                }, ((_, i) => i)); else if ("specific" === options.type) pagesToProcess = options.pages.map((p => p - 1)).filter((i => i >= 0 && i < containers.length)); else if ("range" === options.type) {
                    const start = options.range.start - 1, end = options.range.end - 1;
                    pagesToProcess = [];
                    for (let i = start; i <= end && i < containers.length; i++) pagesToProcess.push(i);
                }
                for (let index = 0; index < pagesToProcess.length; index++) {
                    const i = pagesToProcess[index], container = containers[i];
                    let tCanvas = container.querySelector("canvas[data-ocr-processed='true']");
                    tCanvas && OCRStrategy.updateOverlay(tCanvas), tCanvas || (tCanvas = container.querySelector("canvas"));
                    const iPageWidth = tCanvas?.offsetWidth || pageWidth, iPageHeight = tCanvas?.offsetHeight || pageHeight, iOrientation = pageWidth > pageHeight ? "landscape" : "portrait", backupStyles = [], verticalBoxes = [];
                    container.querySelectorAll(".ocr-box").forEach(((box, idx) => {
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
                    }));
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
                    logFunction(`Preparing translated page ${i + 1}`, "warning");
                    let originalCanvas = container.querySelector("canvas[data-ocr-processed='true']");
                    originalCanvas || (originalCanvas = container.querySelector("canvas"));
                    const bgImg = new Image;
                    bgImg.src = originalCanvas.toDataURL("image/png"), bgImg.style.width = iPageWidth + "px", 
                    bgImg.style.height = iPageHeight + "px", bgImg.setAttribute("width", iPageWidth), 
                    bgImg.setAttribute("height", iPageHeight), bgImg.style.position = "absolute", bgImg.style.top = "0", 
                    bgImg.style.left = "0", bgImg.style.zIndex = "999", bgImg.style.display = "block", 
                    container.insertBefore(bgImg, container.firstChild);
                    const imgData = (await html2canvas(container, {
                        width: iPageWidth,
                        height: iPageHeight,
                        windowWidth: iPageWidth,
                        windowHeight: iPageHeight
                    })).toDataURL("image/jpeg", options.quality);
                    bgImg.remove(), container.querySelectorAll(".ocr-box").forEach(((box, idx) => {
                        const backup = backupStyles[idx];
                        if (!backup) return;
                        box.style.background = backup.background, box.style.backgroundColor = backup.backgroundColor, 
                        box.style.boxShadow = backup.boxShadow, box.style.overflow = backup.overflow, box.style.height = backup.height, 
                        box.style.maxHeight = backup.maxHeight, box.style.padding = backup.padding;
                        const resizeHandles = box.querySelectorAll("[class^='resize-handle']");
                        for (const handle of resizeHandles) handle.style.display = "";
                    }));
                    for (const {box: box, img: img} of tempImages) box.style.display = "", img.remove();
                    index > 0 && (pdf.addPage([ iPageWidth, iPageHeight ], iOrientation), pdf.internal.pageSize.width = iPageWidth, 
                    pdf.internal.pageSize.height = iPageHeight, pdf.internal.pageSize.orientation = iOrientation), 
                    pdf.addImage(imgData, "JPEG", 0, 0, iPageWidth, iPageHeight), await new Promise((resolve => setTimeout(resolve, 500)));
                }
                pdfViewer.style.transform = "scale(" + currentZoomFactor + ")", zoomInButton && (zoomInButton.disabled = !1), 
                zoomOutButton && (zoomOutButton.disabled = !1), logFunction("PDF Ready ✅", "success");
                const name = fileName || "PDF";
                pdf.save(`${name}_translated.pdf`);
            } catch (error) {
                throw error;
            }
        }
    }
    class ProcessPdfPageFacede {
        static async processPage(pdfDoc, pageNum) {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({
                scale: 2,
                dontFlip: !1
            }), canvas = document.createElement("canvas");
            canvas.width = viewport.width, canvas.height = viewport.height, canvas.style.width = viewport.width + "px", 
            canvas.style.height = viewport.height + "px", canvas.crossOrigin = "anonymous", 
            canvas.style.zIndex = "1";
            const context = canvas.getContext("2d"), pageContainer = document.createElement("div");
            pageContainer.classList.add("ocr-container"), pageContainer.style.position = "relative", 
            pageContainer.style.display = "inline-block", await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;
            const textPage = await page.getTextContent();
            textPage.items.length > 0 && (canvas.pdfTextContent = {
                text: textPage,
                viewport: viewport
            }), pageContainer.appendChild(canvas);
            return document.getElementById("pdf-container").appendChild(pageContainer), ImmUtils.observeCanvasResize(canvas), 
            pageContainer;
        }
    }
    class ImageExporterFacade {
        static restoreImageOverlay() {
            try {
                const container = document.getElementById("imageContainer"), overlayImg = document.getElementById("overlayCanvasImage");
                overlayImg && overlayImg.remove(), container.querySelectorAll(".ocr-box").forEach((box => {
                    box.style.display = "";
                }));
                const pdfButton = document.getElementById("downloadPdf");
                pdfButton && (pdfButton.disabled = !1);
            } catch (err) {}
        }
        static async processVerticalBox(box) {
            const clone = box.cloneNode(!0), offscreen = document.createElement("div");
            offscreen.style.position = "fixed", offscreen.style.left = "-9999px", offscreen.style.top = "-9999px", 
            offscreen.style.opacity = "0", document.body.appendChild(offscreen), offscreen.appendChild(clone);
            const rect = box.getBoundingClientRect();
            clone.style.writingMode = "horizontal-tb", clone.style.transform = "none", clone.style.width = rect.height + "px", 
            clone.style.height = rect.width + "px", await new Promise((resolve => requestAnimationFrame(resolve)));
            const dataUrl = (await html2canvas(clone, {
                scale: 2,
                backgroundColor: null
            })).toDataURL("image/png", 1);
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
                container.querySelectorAll(".ocr-box").forEach((box => {
                    const computed = getComputedStyle(box);
                    box.style.background = computed.background, box.style.backgroundColor = computed.backgroundColor, 
                    box.style.border = computed.border, box.style.fontFamily = computed.fontFamily, 
                    box.style.fontSize = computed.fontSize, box.style.color = computed.color, box.style.padding = computed.padding, 
                    box.style.margin = computed.margin, box.style.boxShadow = computed.boxShadow, "vertical-rl" === computed.writingMode && verticalBoxes.push(box);
                }));
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
                const imgData = (await html2canvas(container, {
                    useCORS: !0,
                    allowTaint: !1,
                    ...1 !== viewportScale && {
                        width: pageWidth,
                        height: pageHeight,
                        windowWidth: pageWidth,
                        windowHeight: pageHeight
                    }
                })).toDataURL("image/png", options.quality);
                1 !== viewportScale && bgImg?.remove();
                for (const {box: box, img: img} of tempImages) box.style.display = "", img.remove();
                if (container.style.overflow = backupOverflow, container.style.height = backupHeight, 
                container.style.background = backupBackground, download) {
                    logFunction("Image Ready ✅", "success");
                    const link = document.createElement("a");
                    link.href = imgData, link.download = `${fileName}_translated.png`, link.addEventListener("error", (() => {
                        logFunction("Download canceled", "warning");
                    })), document.body.appendChild(link), link.click(), document.body.removeChild(link);
                } else {
                    let overlayImg = document.getElementById("overlayCanvasImage");
                    overlayImg || (overlayImg = document.createElement("img"), overlayImg.id = "overlayCanvasImage", 
                    overlayImg.style.position = "absolute", overlayImg.style.top = "0", overlayImg.style.left = "0", 
                    overlayImg.style.width = "100%", overlayImg.style.height = "auto", overlayImg.style.zIndex = "9998", 
                    container.appendChild(overlayImg)), overlayImg.src = imgData, overlayImg.style.display = "block", 
                    container.querySelectorAll(".ocr-box").forEach((box => {
                        box.style.display = "none";
                    }));
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
                    apiKey: this.translator.apiKey,
                    openAiUrl: this.translator.openAiUrl,
                    model: this.translator.model,
                    temperature: this.translator.temperature,
                    targetLang: this.translator.targetLang,
                    prompt: this.translator.prompt,
                    type: this.type,
                    callDelay: this.queueDelay
                }
            }), this.worker.addEventListener("message", (e => {
                e.data.type;
                const data = e.data;
                data.requestId && this.pendingWorkerRequests[data.requestId] && ("success" === data.status ? this.pendingWorkerRequests[data.requestId].resolve(data.translation) : this.pendingWorkerRequests[data.requestId].reject(new Error(data.error)), 
                delete this.pendingWorkerRequests[data.requestId]);
            }));
        }
        stopWorker() {
            this.worker.terminate(), this.worker = null, this.pendingWorkerRequests = {};
        }
        async translateText(text) {
            return new Promise(((resolve, reject) => {
                const requestId = "req_" + ImmUtils.generateUUID();
                this.pendingWorkerRequests[requestId] = {
                    resolve: resolve,
                    reject: reject
                }, this.worker.postMessage({
                    action: "translateText",
                    text: text,
                    requestId: requestId
                });
            }));
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
            return container || (container = document.createElement("div"), container.id = "notificationContainer", 
            document.body.appendChild(container)), container;
        }
        showNotification(message, severity = "error", duration = 2e3) {
            const notification = document.createElement("div");
            for (this.container || (this.container = this._createContainer()); this.container.children.length >= this.maxNotifications; ) this.container.removeChild(this.container.firstChild);
            notification.className = `notification ${severity}`, notification.textContent = message, 
            this.container.appendChild(notification), setTimeout((() => {
                notification.classList.add("fade-out"), notification.addEventListener("animationend", (() => notification.remove()));
            }), duration);
        }
    }
    class BaseUIManager {
        constructor() {
            this.notificationManager = new NotificationManager, this.created = !1, this.removed = !1;
        }
        initUI() {
            if (this.created) return;
            const container = this.createTranslationContainer();
            container && !document.getElementById("resetButton") && container.appendChild(this._createResetButton()), 
            document.getElementById("translationFeedbackBox") || container.appendChild(this.createFeedbackBox()), 
            setTimeout((() => {
                container && container.classList.add("hidden");
            }), 1e3), this.created = !0;
        }
        removeUI(duration = 2e3) {
            if (this.removed) return;
            document.getElementById("translationContainer").classList.remove("hidden");
            const box = document.getElementById("translationFeedbackBox");
            setTimeout((() => {
                box.classList.add("fade-out"), box.addEventListener("animationend", (() => {
                    box.remove(), document.getElementById("translationContainer").classList.remove("hidden");
                }));
            }), duration), this.removed = !0;
        }
        _createResetButton() {
            const resetBtn = document.createElement("button");
            return resetBtn.className = "immTransl-control-btn reset", resetBtn.title = "Reset", 
            resetBtn.id = "resetButton", resetBtn.innerHTML = '<svg version="1.0" xmlns="http://www.w3.org/2000/svg"      width="24.000000pt" height="24.000000pt" viewBox="0 0 512.000000 512.000000"      preserveAspectRatio="xMidYMid meet">     <g transform="translate(0.000000,512.000000) scale(0.100000,-0.100000)"     fill="#fff" stroke="none">     <path d="M2390 4794 c-441 -40 -832 -189 -1180 -448 -123 -91 -346 -315 -436     -436 -229 -308 -373 -652 -431 -1030 -24 -158 -24 -482 0 -640 50 -325 167     -635 341 -900 98 -149 164 -230 300 -366 344 -343 765 -554 1256 -630 159 -25     481 -25 640 0 825 127 1497 673 1784 1450 55 148 49 224 -23 289 -46 41 -68     49 -229 82 -128 26 -162 25 -222 -6 -60 -30 -97 -79 -139 -183 -145 -354 -401     -644 -726 -822 -726 -395 -1636 -169 -2097 520 -367 549 -355 1274 30 1816 86     121 251 286 372 372 169 120 400 223 592 262 439 90 826 4 1190 -266 l80 -60     -181 -182 c-116 -118 -187 -197 -197 -222 -53 -124 21 -267 151 -294 34 -7     256 -10 661 -8 l609 3 45 25 c24 14 58 45 75 68 l30 44 3 646 2 646 -26 53     c-33 69 -103 113 -180 113 -87 0 -130 -30 -343 -244 l-194 -194 -76 60 c-308     246 -651 403 -1011 463 -92 16 -379 27 -470 19z"/>     </g>     </svg>', 
            resetBtn.disabled = !1, resetBtn.addEventListener("click", (b => {
                ImmUtils.resetTranslation(BaseUIManager.showNotification, this.updateFeedback), 
                b.remove;
            })), resetBtn;
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
            cancelBtn.disabled = !1, pauseBtn.addEventListener("click", (() => {
                translationPaused || (translationPaused = !0, this.updateFeedback("Translation Paused", !1), 
                pauseBtn.disabled = !0, resumeBtn.disabled = !1);
            })), resumeBtn.addEventListener("click", (() => {
                translationPaused && (translationPaused = !1, this.updateFeedback("Translation Resumed", !0), 
                resumeBtn.disabled = !0, pauseBtn.disabled = !1);
            })), cancelBtn.addEventListener("click", (() => {
                translationCanceled || (translationCanceled = !0, this.updateFeedback("Translation Canceled", !1), 
                pauseBtn.disabled = !0, resumeBtn.disabled = !0, cancelBtn.disabled = !0, this.removeFeedback(0), 
                download && (document.getElementById("downloadPdf").disabled = !1), document.querySelectorAll(".text-spinner, .text-retry-button").forEach((el => el.remove())));
            })), controlContainer.appendChild(pauseBtn), controlContainer.appendChild(resumeBtn), 
            controlContainer.appendChild(cancelBtn), controlContainer;
        }
        createTranslationContainer() {
            if (!document.getElementById("translationContainer")) {
                const container = document.createElement("div");
                return container.id = "translationContainer", container.style.position = "fixed", 
                container.style.bottom = "20px", container.style.right = "20px", container.style.display = "flex", 
                container.style.alignItems = "center", container.style.gap = "8px", document.body.appendChild(container), 
                container;
            }
        }
        createFeedbackBox() {
            let box = document.getElementById("translationFeedbackBox");
            if (!box) {
                box = document.createElement("div"), box.id = "translationFeedbackBox";
                const arrow = document.createElement("div");
                arrow.className = "immTransl-arrow", arrow.innerHTML = '<svg version="1.0" xmlns="http://www.w3.org/2000/svg"\n             width="32.000000pt" height="32.000000pt" viewBox="0 0 512.000000 512.000000"\n             preserveAspectRatio="xMidYMid meet">\n            <g transform="translate(0.000000,512.000000) scale(0.100000,-0.100000)"\n            fill="#fff" stroke="none">\n            <path d="M1400 5098 c-44 -17 -77 -44 -171 -137 -144 -143 -163 -177 -164\n            -286 0 -58 5 -91 19 -120 13 -27 333 -355 995 -1018 l976 -977 -977 -978\n            c-760 -760 -982 -987 -997 -1022 -14 -30 -21 -67 -21 -110 0 -103 29 -153 168\n            -291 98 -97 127 -119 175 -137 73 -28 131 -28 204 -1 56 20 108 71 1230 1193\n            1297 1296 1223 1214 1223 1346 0 132 74 50 -1223 1346 -1123 1123 -1174 1173\n            -1230 1193 -72 26 -136 26 -207 -1z"/>\n            </g>\n            </svg>\n              ', 
                arrow.addEventListener("click", (function(e) {
                    e.stopPropagation(), document.getElementById("translationContainer").classList.toggle("hidden");
                })), box.appendChild(arrow);
                const spinner = document.createElement("div");
                spinner.className = "spinner", spinner.addEventListener("click", (function(e) {
                    e.stopPropagation(), box.classList.toggle("hidden");
                })), box.appendChild(spinner);
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
                text && (text.textContent = message);
                const spinner = box.querySelector(".spinner");
                spinner && (spinner.style.display = showSpinner ? "block" : "none");
            }
        }
        removeFeedback(delay = 2e3) {
            document.getElementById("translationContainer").classList.remove("hidden");
            const box = document.getElementById("translationFeedbackBox");
            setTimeout((() => {
                box.classList.add("fade-out"), box.addEventListener("animationend", (() => {
                    box.remove(), document.getElementById("translationContainer").classList.remove("hidden");
                }));
            }), delay);
        }
        static showNotification(message, severity, duration) {
            (new NotificationManager).showNotification(message, severity, duration);
        }
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
            const maxPages = containers.length, options = await PDFUIManager.showPdfOptionsModal(maxPages), pdfExporter = new PdfExporterFacade, exportCommand = new ExportPdfCommand(pdfExporter);
            try {
                await exportCommand.execute(options, PDFUIManager.showNotification);
            } catch (error) {
                PDFUIManager.showNotification(error, "error");
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
            document.getElementById("downloadPdf").addEventListener("click", this.exportPdfCallback);
        }
        static async showPdfOptionsModal(maxPages) {
            return new Promise(((resolve, reject) => {
                if (document.getElementById("pdfOptionsOverlay")) return;
                const overlay = document.createElement("div");
                overlay.id = "pdfOptionsOverlay";
                const modal = document.createElement("div");
                modal.id = "pdfOptionsModal", modal.innerHTML = '\n          <h2>PDF Options</h2>\n          <form id="pdfOptionsForm">\n            <div>\n              <input type="radio" id="optionAll" name="pdfOption" value="all" checked>\n              <label for="optionAll">Entire PDF</label>\n            </div>\n            <div>\n              <input type="radio" id="optionSpecific" name="pdfOption" value="specific">\n              <label for="optionSpecific">Specific Pages</label>\n              <input type="text" id="specificPages" placeholder="e.g. 1,3,5" disabled>\n            </div>\n            <div>\n              <input type="radio" id="optionRange" name="pdfOption" value="range">\n              <label for="optionRange">Page Range</label>\n              <div style="display: flex; gap: 10px; margin-top: 8px;">\n                <input type="number" id="rangeStart" placeholder="From" disabled>\n                <input type="number" id="rangeEnd" placeholder="To" disabled>\n              </div>\n            </div>\n            <div class="quality-container">\n              <label for="pdfQuality">PDF Quality (Optimal 70%):</label>\n              <input type="range" id="pdfQuality" min="10" max="100" value="70" style="vertical-align: middle; margin: 0 8px;">\n              <span id="pdfQualityValue">70%</span>\n            </div>\n            <div class="button-group">\n              <button type="button" id="cancelPdfOptions">Cancel</button>\n              <button type="submit" id="confirmPdfOptions">Download</button>\n            </div>\n          </form>\n          ', 
                overlay.appendChild(modal), document.body.appendChild(overlay);
                const pdfQualitySlider = modal.querySelector("#pdfQuality"), pdfQualityValue = modal.querySelector("#pdfQualityValue");
                pdfQualitySlider.addEventListener("input", (() => {
                    pdfQualityValue.textContent = pdfQualitySlider.value + "%";
                }));
                const specificPagesInput = modal.querySelector("#specificPages"), rangeStartInput = modal.querySelector("#rangeStart"), rangeEndInput = modal.querySelector("#rangeEnd");
                rangeStartInput.setAttribute("min", "1"), rangeStartInput.setAttribute("max", maxPages), 
                rangeEndInput.setAttribute("min", "1"), rangeEndInput.setAttribute("max", maxPages);
                modal.querySelectorAll('input[name="pdfOption"]').forEach((radio => {
                    radio.addEventListener("change", (() => {
                        specificPagesInput.disabled = !modal.querySelector("#optionSpecific").checked, rangeStartInput.disabled = !modal.querySelector("#optionRange").checked, 
                        rangeEndInput.disabled = !modal.querySelector("#optionRange").checked;
                    }));
                }));
                modal.querySelector("#pdfOptionsForm").addEventListener("submit", (e => {
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
                        let pages = specificPagesInput.value.split(",").map((num => parseInt(num.trim()))).filter((num => !isNaN(num)));
                        if (0 === pages.length) return void alert("Please enter at least one valid page number.");
                        if (pages.filter((page => page < 1 || page > maxPages)).length > 0) return void alert(`All page numbers must be between 1 and ${maxPages}.`);
                        result.pages = pages;
                    }
                    document.body.removeChild(overlay), resolve(result);
                }));
                modal.querySelector("#cancelPdfOptions").addEventListener("click", (() => {
                    document.body.removeChild(overlay);
                }));
            }));
        }
        applyZoom() {
            const pdf_viewer = document.getElementById("pdf-viewer");
            if (!pdf_viewer) return;
            const viewerRect = pdf_viewer.getBoundingClientRect(), visibleLeft = Math.max(viewerRect.left, 0), visibleTop = Math.max(viewerRect.top, 0), visibleCenterX = (visibleLeft + Math.min(viewerRect.right, window.innerWidth)) / 2, visibleCenterY = (visibleTop + Math.min(viewerRect.bottom, window.innerHeight)) / 2, viewportCenterX = window.scrollX + visibleCenterX, viewportCenterY = window.scrollY + visibleCenterY, viewerLeft = viewerRect.left + window.scrollX, viewerTop = viewerRect.top + window.scrollY, relativeCenterX = viewportCenterX - viewerLeft, relativeCenterY = viewportCenterY - viewerTop, oldZoom = this.zoomFactorOld || 1, newZoom = this.zoomFactor, contentX = relativeCenterX / oldZoom, contentY = relativeCenterY / oldZoom;
            if (pdf_viewer.style.transition = "transform 0.05s ease", newZoom < 1) {
                this.currentPageIndex;
                pdf_viewer.style.transformOrigin = "top center", pdf_viewer.style.transform = `scale(${newZoom})`;
                const newCenterY = viewerTop + contentY * newZoom, newScrollY = (window.innerWidth, 
                newCenterY - window.innerHeight / 2);
                window.scrollTo({
                    top: newScrollY
                });
            } else {
                pdf_viewer.style.transformOrigin = "top left", pdf_viewer.style.transform = `scale(${newZoom})`;
                const newCenterY = viewerTop + contentY * newZoom, newScrollX = viewerLeft + contentX * newZoom - window.innerWidth / 2, newScrollY = newCenterY - window.innerHeight / 2;
                window.scrollTo({
                    left: newScrollX,
                    top: newScrollY
                });
            }
            this.zoomFactorOld = newZoom;
        }
        updateOcrBoxesForZoom(container) {
            if (0 === container.querySelectorAll(".ocr-box").length) return;
            const canvas = container.querySelector("canvas");
            canvas && OCRStrategy.updateOverlay(canvas, null, null);
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
            if (this.pageContainers.forEach(((container, index) => {
                container.style.display = "block";
            })), this.pageContainers[this.currentPageIndex]) {
                this.pageContainers[this.currentPageIndex].scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
                this.pageContainers[this.currentPageIndex].querySelector("canvas");
            }
        }
        addToolbarListeners(pdfDoc, worker, translator, scale) {
            document.getElementById("pdf-container");
            document.getElementById("prevPage").addEventListener("click", (async () => {
                this.currentPageIndex > 0 && (this.currentPageIndex--, this.showCurrentPage());
            })), document.getElementById("nextPage").addEventListener("click", (() => {
                this.currentPageIndex < this.totalPages - 1 && (this.currentPageIndex++, this.showCurrentPage());
            })), document.getElementById("zoomIn").addEventListener("click", (() => {
                this.zoomIn();
            })), document.getElementById("zoomOut").addEventListener("click", (() => {
                this.zoomOut();
            }));
        }
        async createPdfPages(pdfDoc) {
            this.totalPages = pdfDoc.numPages;
            const pageProcessor = new ProcessPdfPageFacede, processCommand = new ProcessPdfPageCommand(pageProcessor), observer = new IntersectionObserver((entries => {
                entries.forEach((entry => {
                    const requiredVisibility = (() => {
                        const viewportWidth = window.innerWidth;
                        return viewportWidth <= 600 ? .5 : viewportWidth <= 1200 ? .35 : viewportWidth <= 1800 ? .25 : .15;
                    })();
                    entry.isIntersecting && entry.intersectionRatio * this.zoomFactor >= requiredVisibility && (this.currentPageIndex = Array.from(this.pageContainers).indexOf(entry.target), 
                    this.updatePageIndicator());
                }));
            }), {
                root: null,
                threshold: [ 0, .15, .25, .35, .5, .75, 1 ],
                rootMargin: "0px"
            });
            this.pageContainers = [];
            for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
                const container = await processCommand.execute(pdfDoc, pageNum);
                this.pageContainers.push(container), observer.observe(container);
            }
            return this.currentPageIndex = 0, this.showCurrentPage(), this.addToolbarListeners(), 
            this.updateZoomIndicator(), this.pageContainers;
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
                return new BaseUIManager;

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
    class TesseractAdapter extends OCREngine {
        constructor(languages = "eng", tesseractOptions = null) {
            super(), this.worker = null, this.languages = languages, this.tesseractOptions = tesseractOptions;
        }
        async initEngine() {
            this.worker = await Tesseract.createWorker(this.languages), this.tesseractOptions && await this.worker.setParameters(this.tesseractOptions);
        }
        async terminateEngine() {
            this.worker && await this.worker.terminate();
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
            OCRStrategy.debounce(((element, tempCanvas, iElementData) => {
                OCRStrategy.updateOverlay(element, tempCanvas, iElementData), this._overlayUpdateScheduled = !1;
            }), 100)(e, t, i);
        }
        async process(element) {
            throw new Error("Metodo process() non implementato in OCRStrategy");
        }
        static adjustFontSize(box) {
            const handles = box.querySelectorAll(".resize-handle"), handleDisplays = [];
            handles.forEach((handle => {
                handleDisplays.push(handle.style.display), handle.style.display = "none";
            }));
            let fontSize, low = 1e-5, high = 30;
            for (let i = 0; i < 10; i++) fontSize = (low + high) / 2, box.style.fontSize = fontSize + "px", 
            box.scrollHeight <= box.clientHeight ? low = fontSize : high = fontSize;
            box.style.fontSize = low + "px";
            let idx = 0;
            handles.forEach((handle => {
                handle.style.display = handleDisplays[idx++];
            }));
        }
        static retryOcrBoxTranslation(img, idx, trFunc) {
            const boxes = Array.from(img.parentElement.querySelectorAll(".ocr-box")), box = boxes.find((b => parseInt(b.getAttribute("data-ocr-index"), 10) === Number(idx)));
            if (idx < 0 || idx >= boxes.length) return;
            if (!box) return;
            const dataAttr = box.getAttribute("data-ocr-info");
            if (!dataAttr) return;
            const data = JSON.parse(dataAttr), translator = trFunc || img.ocrTranslator;
            translator && (data.translatedText = "", box.setAttribute("data-ocr-info", JSON.stringify(data)), 
            OCRStrategy.updateBoxesInChunks(img, [ box ]), translator.translateText(data.originalText.replace(/<br>/gi, "[[BR]]")).then((translatedText => {
                const finalText = ImmUtils.decodeHTMLEntities(translatedText).replace(/\[\[BR\]\]/g, "<br>");
                data.translatedText = finalText, box.setAttribute("data-ocr-info", JSON.stringify(data)), 
                OCRStrategy.updateBoxesInChunks(img, [ box ]);
            })).catch((e => {
                data.translatedText = "[[ERROR]]", box.setAttribute("data-ocr-info", JSON.stringify(data)), 
                OCRStrategy.updateBoxesInChunks(img, [ box ]);
            })));
        }
        static sampleMedianColor(ctx, x, y, width, height) {
            const data = ctx.getImageData(x, y, width, height).data, rValues = [], gValues = [], bValues = [], aValues = [];
            for (let i = 0; i < data.length; i += 4) rValues.push(data[i]), gValues.push(data[i + 1]), 
            bValues.push(data[i + 2]), aValues.push(data[i + 3]);
            function median(values) {
                values.sort(((a, b) => a - b));
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
        static updateBoxesInChunks(element, boxes, offsetX, offsetY, zoomFactor, corsFreeCanvas, lastTranslatedIndex, translator = null) {
            const currTranslator = translator || element.ocrTranslator;
            if (1 === boxes.length) {
                let b = boxes[0];
                const data = b?.getAttribute("data-ocr-info");
                if (data) {
                    const d = JSON.parse(data);
                    setTimeout((() => updateBox(b, d, 0)), 50);
                }
                return;
            }
            if (null != lastTranslatedIndex && lastTranslatedIndex >= 0 && lastTranslatedIndex < boxes.length) {
                let b = boxes[lastTranslatedIndex];
                const data = b?.getAttribute("data-ocr-info");
                if (data) {
                    const d = JSON.parse(data);
                    setTimeout((() => updateBox(b, d, lastTranslatedIndex)), 50);
                }
                return;
            }
            let currentIndex = 0;
            function updateBox(box, data, boxIndex) {
                if (!box) return;
                const html = box.innerHTML.trim(), {bbox: bbox, translatedText: translatedText, baseline: baseline} = data, x = offsetX + bbox.x0 * zoomFactor, y = offsetY + bbox.y0 * zoomFactor, boxWidth = (bbox.x1 - bbox.x0) * zoomFactor, boxHeight = (bbox.y1 - bbox.y0) * zoomFactor;
                if (requestAnimationFrame((() => {
                    box.style.setProperty("--pos-x", `${x}px`), box.style.setProperty("--pos-y", `${y}px`), 
                    box.style.setProperty("--box-width", `${boxWidth}px`), box.style.setProperty("--box-height", `${boxHeight}px`);
                })), -1 === boxIndex && (html.includes('class="spinner"') || html.includes("ocr-retry-btn"))) return;
                if (translatedText && "" !== translatedText) if ("[[ERROR]]" === translatedText) {
                    box.querySelectorAll(":scope > .spinner, :scope > .ocr-retry-btn, :scope > .ocr-box-text").forEach((el => el.remove()));
                    const btn = document.createElement("button");
                    btn.className = "ocr-retry-btn", btn.textContent = "↻", currTranslator && (btn.onclick = function(e) {
                        e.preventDefault(), e.stopPropagation(), OCRStrategy.retryOcrBoxTranslation(element, box.dataset.index, currTranslator);
                    }), box.appendChild(btn), box.classList.add("ocr-box-error"), box.style.cursor = "pointer", 
                    box.contentEditable = "false";
                } else {
                    box.querySelectorAll(":scope > .spinner, :scope > .ocr-retry-btn, :scope > .ocr-box-text").forEach((el => el.remove()));
                    const textEl = document.createElement("div");
                    textEl.className = "ocr-box-text", textEl.innerHTML = translatedText, box.appendChild(textEl), 
                    box.classList.remove("ocr-box-error"), OCRStrategy.calculateBoxColor(data, element, corsFreeCanvas, bbox, box, parseInt(box.dataset.index));
                } else {
                    box.querySelectorAll(":scope > .spinner, :scope > .ocr-retry-btn, :scope > .ocr-box-text").forEach((el => el.remove()));
                    const spinner = document.createElement("div");
                    spinner.className = "spinner", box.appendChild(spinner), box.classList.remove("ocr-box-error"), 
                    box.style.cursor = "default", box.contentEditable = "false";
                }
                if (-1 === boxIndex && "" !== html && !html.includes('class="spinner"') && !html.includes("ocr-retry-btn")) {
                    try {
                        OCRStrategy.adjustFontSize(box);
                    } catch (e) {}
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
                box.style.transformOrigin = "top left"), requestAnimationFrame((() => {
                    box.dataset.rotation = angleDeg, box.style.transform = `${rotationTransform}`;
                }));
                try {
                    OCRStrategy.adjustFontSize(box);
                } catch (e) {}
            }
            requestAnimationFrame((function updateChunk() {
                for (let j = 0; j < 5 && currentIndex < boxes.length; j++, currentIndex++) {
                    let b = boxes[currentIndex];
                    const d = b?.getAttribute("data-ocr-info");
                    if (!d) continue;
                    updateBox(b, JSON.parse(d), -1);
                }
                currentIndex < boxes.length && setTimeout(updateChunk, 50);
            }));
        }
        static updateOverlay(element, corsFreeCanvas = null, iElementData = null, translator = null) {
            const container = element.parentElement;
            if (!element.ocrData) {
                const boxes = Array.from(container.querySelectorAll(".ocr-box")).sort(((a, b) => parseInt(a.getAttribute("data-ocr-index"), 10) - parseInt(b.getAttribute("data-ocr-index"), 10)));
                if (0 === boxes.length) return;
                const canvasRect = element.getBoundingClientRect(), containerRect = container.getBoundingClientRect(), baseWidth = element.ocrBaseWidth || canvasRect.width;
                let pdfZoomFactor = 0;
                const pdfViewer = document.getElementById("pdf-viewer");
                if (pdfOCR && pdfViewer && pdfViewer.style.transform) {
                    const match = pdfViewer.style.transform.match(/scale\(([\d.]+)\)/);
                    match && match[1] && (pdfZoomFactor = parseFloat(match[1]));
                }
                let zoomFactor = pdfZoomFactor > 0 ? canvasRect.width / baseWidth / pdfZoomFactor : canvasRect.width / baseWidth;
                const offsetX = canvasRect.left - containerRect.left, offsetY = canvasRect.top - containerRect.top;
                let lastTranslatedIndex = -1;
                return iElementData >= 0 && (lastTranslatedIndex = iElementData), OCRStrategy.enableDragResizeForBoxes(element, corsFreeCanvas), 
                void OCRStrategy.updateBoxesInChunks(element, boxes, offsetX, offsetY, zoomFactor, corsFreeCanvas, lastTranslatedIndex, translator);
            }
            const canvasRect = element.getBoundingClientRect(), containerRect = container.getBoundingClientRect(), baseWidth = element.ocrBaseWidth || canvasRect.width;
            let pdfZoomFactor = 0;
            const pdfViewer = document.getElementById("pdf-viewer");
            if (pdfOCR && pdfViewer && pdfViewer.style.transform) {
                const match = pdfViewer.style.transform.match(/scale\(([\d.]+)\)/);
                match && match[1] && (pdfZoomFactor = parseFloat(match[1]));
            }
            let zoomFactor = pdfZoomFactor > 0 ? canvasRect.width / baseWidth / pdfZoomFactor : canvasRect.width / baseWidth;
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
                        box.style.background = `rgba(${avgColor.r}, ${avgColor.g}, ${avgColor.b}, ${avgColor.a / 255})`;
                        const brightness = (299 * avgColor.r + 587 * avgColor.g + 114 * avgColor.b) / 1e3;
                        box.style.color = brightness < 128 ? "#fff" : "#000", data.color = avgColor, box.setAttribute("data-ocr-info", JSON.stringify(data));
                    }
                }
            } catch (error) {}
        }
        static _initializedBoxes=new WeakSet;
        static enableDragResizeForBoxes(img, canvas = null) {
            const container = img.parentElement, boxes = container.querySelectorAll(".ocr-box"), baseWidth = img.ocrBaseWidth || img.naturalWidth || img.width, containerRect = container.getBoundingClientRect(), imgRect = img.getBoundingClientRect(), offsetX = imgRect.left - containerRect.left, offsetY = imgRect.top - containerRect.top;
            let pdfZoomFactor = 0;
            const pdfViewer = document.getElementById("pdf-viewer");
            if (pdfOCR && pdfViewer && pdfViewer.style.transform) {
                const match = pdfViewer.style.transform.match(/scale\(([\d.]+)\)/);
                match && match[1] && (pdfZoomFactor = parseFloat(match[1]));
            }
            let zoomFactor;
            zoomFactor = pdfZoomFactor > 0 ? imgRect.width / baseWidth / pdfZoomFactor : imgRect.width / baseWidth, 
            boxes.forEach((box => {
                if (OCRStrategy._initializedBoxes.has(box)) return;
                const handles = {};
                [ "top", "right", "bottom", "left" ].forEach((side => {
                    const handle = document.createElement("div");
                    handle.className = "resize-handle " + side, handle.style.position = "absolute", 
                    handle.style.background = "transparent", "top" === side || "bottom" === side ? (handle.style.height = "8px", 
                    handle.style.width = "100%", handle.style.left = "0", handle.style.cursor = "ns-resize", 
                    "top" === side ? handle.style.top = "-4px" : handle.style.bottom = "-4px") : (handle.style.width = "8px", 
                    handle.style.height = "100%", handle.style.top = "0", handle.style.cursor = "ew-resize", 
                    "left" === side ? handle.style.left = "-4px" : handle.style.right = "-4px"), box.appendChild(handle), 
                    handles[side] = handle;
                }));
                [ "top-left", "top-right", "bottom-right", "bottom-left" ].forEach((corner => {
                    const handle = document.createElement("div");
                    handle.className = "resize-handle " + corner, handle.style.position = "absolute", 
                    handle.style.background = "transparent", handle.style.width = "12px", handle.style.height = "12px", 
                    "top-left" === corner ? (handle.style.top = "-6px", handle.style.left = "-6px", 
                    handle.style.cursor = "nwse-resize") : "top-right" === corner ? (handle.style.top = "-6px", 
                    handle.style.right = "-6px", handle.style.cursor = "nesw-resize") : "bottom-right" === corner ? (handle.style.bottom = "-6px", 
                    handle.style.right = "-6px", handle.style.cursor = "nwse-resize") : "bottom-left" === corner && (handle.style.bottom = "-6px", 
                    handle.style.left = "-6px", handle.style.cursor = "nesw-resize"), box.appendChild(handle), 
                    handles[corner] = handle;
                }));
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
                        dragStartTime = Date.now(), currentDraggingBox = this, dragTimer = setTimeout((() => {
                            isDragging = !0, updatePending = !0, box.style.cursor = "move", box.classList.add("dragging"), 
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
                        }), 300);
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
                        box.style.cursor = "default", box.classList.remove("dragging"), function enableScrollOnContainer() {
                            const pdfContainer = document.getElementById("pdf-container");
                            pdfContainer && (pdfContainer.classList.remove("dragging"), pdfContainer.removeEventListener("touchmove", preventDefault, {
                                passive: !1
                            }));
                        }(), isDragging = !1, updatePending && (OCRStrategy.updateBoxOcrData(box, offsetX, offsetY, zoomFactor, img, canvas), 
                        updatePending = !1);
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
                        updateNeeded = !1));
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
                }, attachResizeListener(handles.right, (function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    const angle = parseFloat(box.dataset.rotation) || 0;
                    Math.abs(Math.abs(angle) - 90) < 1 ? box.style.setProperty("--box-height", `${origHeight + diffX}px`) : box.style.setProperty("--box-width", `${origWidth + diffX}px`), 
                    OCRStrategy.adjustFontSize(box);
                })), attachResizeListener(handles.left, (function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    const angle = parseFloat(box.dataset.rotation) || 0;
                    Math.abs(Math.abs(angle) - 90) < 1 ? (box.style.setProperty("--box-height", origHeight - diffX + "px"), 
                    box.style.setProperty("--pos-y", `${origTop + diffX}px`)) : (box.style.setProperty("--box-width", origWidth - diffX + "px"), 
                    box.style.setProperty("--pos-x", `${origLeft + diffX}px`)), OCRStrategy.adjustFontSize(box);
                })), attachResizeListener(handles.bottom, (function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    const angle = parseFloat(box.dataset.rotation) || 0;
                    Math.abs(Math.abs(angle) - 90) < 1 ? box.style.setProperty("--box-width", `${origWidth + diffY}px`) : box.style.setProperty("--box-height", `${origHeight + diffY}px`), 
                    OCRStrategy.adjustFontSize(box);
                })), attachResizeListener(handles.top, (function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    const angle = parseFloat(box.dataset.rotation) || 0;
                    Math.abs(Math.abs(angle) - 90) < 1 ? (box.style.setProperty("--box-width", origWidth - diffY + "px"), 
                    box.style.setProperty("--pos-x", `${origLeft + diffY}px`)) : (box.style.setProperty("--pos-y", `${origTop + diffY}px`), 
                    box.style.setProperty("--box-height", origHeight - diffY + "px")), OCRStrategy.adjustFontSize(box);
                })), attachResizeListener(handles["top-left"], (function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.setProperty("--pos-x", `${origLeft + diffX}px`), box.style.setProperty("--pos-y", `${origTop + diffY}px`), 
                    box.style.setProperty("--box-width", origWidth - diffX + "px"), box.style.setProperty("--box-height", origHeight - diffY + "px"), 
                    OCRStrategy.adjustFontSize(box);
                })), attachResizeListener(handles["top-right"], (function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.setProperty("--box-height", origHeight - diffY + "px"), box.style.setProperty("--box-width", `${origWidth + diffX}px`), 
                    box.style.setProperty("--pos-y", `${origTop + diffY}px`), OCRStrategy.adjustFontSize(box);
                })), attachResizeListener(handles["bottom-right"], (function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.setProperty("--box-width", `${origWidth + diffX}px`), box.style.setProperty("--box-height", `${origHeight + diffY}px`), 
                    OCRStrategy.adjustFontSize(box);
                })), attachResizeListener(handles["bottom-left"], (function(box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.setProperty("--box-width", origWidth - diffX + "px"), box.style.setProperty("--box-height", `${origHeight + diffY}px`), 
                    box.style.setProperty("--pos-x", `${origLeft + diffX}px`), OCRStrategy.adjustFontSize(box);
                })), OCRStrategy._initializedBoxes.add(box);
            }));
        }
        static updateBoxOcrData(box, offsetX, offsetY, zoomFactor, img, canvas = null, color = !1) {
            const computed = getComputedStyle(box), newLeft = parseFloat(computed.left), newTop = parseFloat(computed.top), newX0 = (newLeft - offsetX) / zoomFactor, newY0 = (newTop - offsetY) / zoomFactor, newX1 = (newLeft - offsetX + parseFloat(computed.width)) / zoomFactor, newY1 = (newTop - offsetY + parseFloat(computed.height)) / zoomFactor, index = parseInt(box.dataset.index, 10), dataStr = box.getAttribute("data-ocr-info");
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
            function computeBoxFeatures(item) {
                const {x0: x0, y0: y0, x1: x1, y1: y1} = item.bbox, xCenter = (x0 + x1) / 2, yCenter = (y0 + y1) / 2, width = x1 - x0, height = y1 - y0;
                let angle = 0;
                return item.baseline && void 0 !== item.baseline.x0 && void 0 !== item.baseline.y0 && void 0 !== item.baseline.x1 && void 0 !== item.baseline.y1 && (angle = Math.atan2(item.baseline.y1 - item.baseline.y0, item.baseline.x1 - item.baseline.x0) * (180 / Math.PI)), 
                {
                    xCenter: xCenter,
                    yCenter: yCenter,
                    width: width,
                    height: height,
                    angle: angle
                };
            }
            const boxes = ocrData.map((item => ({
                item: item,
                features: computeBoxFeatures(item)
            })));
            let totalWidth = 0, totalHeight = 0;
            function frontierPoints(bbox, direction) {
                const {x0: x0, y0: y0, x1: x1, y1: y1} = bbox;
                switch (direction) {
                  case "right":
                    return [ {
                        x: x1,
                        y: y0
                    }, {
                        x: x1,
                        y: (y0 + y1) / 2
                    }, {
                        x: x1,
                        y: y1
                    } ];

                  case "left":
                    return [ {
                        x: x0,
                        y: y0
                    }, {
                        x: x0,
                        y: (y0 + y1) / 2
                    }, {
                        x: x0,
                        y: y1
                    } ];

                  case "top":
                    return [ {
                        x: x0,
                        y: y0
                    }, {
                        x: (x0 + x1) / 2,
                        y: y0
                    }, {
                        x: x1,
                        y: y0
                    } ];

                  case "bottom":
                    return [ {
                        x: x0,
                        y: y1
                    }, {
                        x: (x0 + x1) / 2,
                        y: y1
                    }, {
                        x: x1,
                        y: y1
                    } ];

                  default:
                    return [ {
                        x: x0,
                        y: y0
                    }, {
                        x: x1,
                        y: y0
                    }, {
                        x: x1,
                        y: y1
                    }, {
                        x: x0,
                        y: y1
                    }, {
                        x: (x0 + x1) / 2,
                        y: y0
                    }, {
                        x: x1,
                        y: (y0 + y1) / 2
                    }, {
                        x: (x0 + x1) / 2,
                        y: y1
                    }, {
                        x: x0,
                        y: (y0 + y1) / 2
                    } ];
                }
            }
            function boxDistance(b1, b2) {
                const bbox1 = b1.item.bbox, bbox2 = b2.item.bbox, points1 = frontierPoints(bbox1), points2 = frontierPoints(bbox2);
                let minDistance = 1 / 0;
                for (let i = 0; i < points1.length; i++) for (let j = 0; j < points2.length; j++) {
                    const dx = points1[i].x - points2[j].x, dy = points1[i].y - points2[j].y, dist = Math.sqrt(dx * dx + dy * dy);
                    dist < minDistance && (minDistance = dist);
                }
                const angle1 = b1.features.angle, angle2 = b2.features.angle;
                let angleDiff = Math.abs(angle1 - angle2);
                return angleDiff > 90 && (angleDiff = 180 - angleDiff), minDistance + angleDiff;
            }
            boxes.forEach((b => {
                totalWidth += b.features.width, totalHeight += b.features.height;
            }));
            const clusters = [], visited = new Array(boxes.length).fill(!1), assigned = new Array(boxes.length).fill(!1), noise = [];
            function regionQuery(idx) {
                const neighbors = [];
                for (let j = 0; j < boxes.length; j++) j !== idx && boxDistance(boxes[idx], boxes[j]) <= eps && neighbors.push(j);
                return neighbors;
            }
            function expandCluster(idx, neighbors, cluster) {
                cluster.push(idx), assigned[idx] = !0;
                let queue = [ ...neighbors ];
                for (;queue.length > 0; ) {
                    const current = queue.shift();
                    if (!visited[current]) {
                        visited[current] = !0;
                        const currentNeighbors = regionQuery(current);
                        currentNeighbors.length >= minPts && (queue = queue.concat(currentNeighbors));
                    }
                    assigned[current] || (cluster.push(current), assigned[current] = !0);
                }
            }
            for (let i = 0; i < boxes.length; i++) {
                if (visited[i]) continue;
                visited[i] = !0;
                const neighbors = regionQuery(i);
                if (neighbors.length < minPts) noise.push(i); else {
                    const cluster = [];
                    expandCluster(i, neighbors, cluster), clusters.push(cluster);
                }
            }
            function median(arr) {
                const sorted = arr.slice().sort(((a, b) => a - b)), mid = Math.floor(sorted.length / 2);
                return sorted.length % 2 == 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
            }
            noise.filter((i => !assigned[i])).forEach((i => {
                clusters.push([ i ]);
            }));
            return clusters.map((clusterIndices => {
                const clusterItems = clusterIndices.map((i => boxes[i].item));
                clusterItems.sort(((a, b) => a.bbox.y0 !== b.bbox.y0 ? a.bbox.y0 - b.bbox.y0 : a.bbox.x0 - b.bbox.x0));
                const x0 = Math.min(...clusterItems.map((item => item.bbox.x0))), y0 = Math.min(...clusterItems.map((item => item.bbox.y0))), x1 = Math.max(...clusterItems.map((item => item.bbox.x1))), y1 = Math.max(...clusterItems.map((item => item.bbox.y1))), aggregatedText = clusterItems.map((item => item.text)).join(" "), baselines = clusterItems.map((item => item.baseline)).filter((b => b));
                return {
                    bbox: {
                        x0: x0,
                        y0: y0,
                        x1: x1,
                        y1: y1
                    },
                    baseline: {
                        x0: median(baselines.map((b => b.x0))),
                        y0: median(baselines.map((b => b.y0))),
                        x1: median(baselines.map((b => b.x1))),
                        y1: median(baselines.map((b => b.y1)))
                    },
                    originalText: aggregatedText,
                    translatedText: ""
                };
            }));
        }
        static debounce(func, wait) {
            let timeout;
            return function(...args) {
                clearTimeout(timeout), timeout = setTimeout((() => func.apply(this, args)), wait);
            };
        }
        scheduleOverlayUpdate(element, tempCanvas = null, iElementData = null) {
            this._overlayUpdateScheduled || (this._overlayUpdateScheduled = !0, requestAnimationFrame((() => {
                OCRStrategy.debouncedUpdate(element, tempCanvas, iElementData);
            })));
        }
        static getResultLines(result) {
            if (!result || !result.data || !result.data.blocks) return result.data = {
                lines: []
            }, result;
            const lines = result.data.blocks.map((block => block.paragraphs.map((paragraph => paragraph.lines)))).flat(2);
            return result.data.lines = lines, result;
        }
        async _processOcrResult(element, container, tempCanvas, result, groupingThreshold = 20) {
            result.data && result.data.lines || (result = OCRStrategy.getResultLines(result));
            let filteredLines = result.data.lines.filter((line => "" !== line.text.trim()));
            if (0 === filteredLines.length) return element.ocrData = [], void (element.dataset.ocrProcessed = "true");
            const rawOcrData = filteredLines.map((line => ({
                bbox: line.bbox,
                baseline: line.baseline,
                translatedText: "",
                text: line.text.trim()
            }))), blocks = OCRStrategy.groupOcrData(rawOcrData, groupingThreshold);
            element.ocrData = blocks, "static" === getComputedStyle(container).position && (container.style.position = "relative"), 
            ImmUtils.checkPaused(), ImmUtils.yieldControl(), OCRStrategy.updateOverlay(element, tempCanvas);
            const boxes = Array.from(element.parentElement.querySelectorAll(".ocr-box")).sort(((a, b) => parseInt(a.getAttribute("data-ocr-index"), 10) - parseInt(b.getAttribute("data-ocr-index"), 10))), translationPromises = blocks.map((block => block.originalText.replace(/<br>/gi, "[[BR]]"))).map(((text, i) => (async () => {
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
            })()));
            await Promise.all(translationPromises), element.dataset.ocrProcessed = "true";
        }
    }
    class ImageOCRStrategy extends OCRStrategy {
        constructor(adapter, translator) {
            super(adapter, translator);
        }
        async process(img) {
            if (await ImmUtils.checkPaused(), "true" === img.dataset.ocrProcessed) return;
            img.complete || await new Promise((resolve => {
                img.onload = resolve;
            }));
            let imageForOCR = img;
            if (!img.crossOrigin || "anonymous" !== img.crossOrigin) try {
                const response = await fetch(img.src), blob = await response.blob(), dataUrl = await new Promise(((resolve, reject) => {
                    const reader = new FileReader;
                    reader.onload = () => resolve(reader.result), reader.onerror = reject, reader.readAsDataURL(blob);
                }));
                imageForOCR = new Image, imageForOCR.src = dataUrl, await new Promise((resolve => {
                    imageForOCR.onload = resolve;
                }));
            } catch (error) {}
            let container = img.parentElement;
            container.classList.contains("ocr-container") || (container = document.createElement("div"), 
            container.classList.add("ocr-container"), container.style.position = "relative", 
            container.style.display = "flex", img.parentElement.insertBefore(container, img), 
            container.appendChild(img));
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
                    lines: textPage.items.filter((item => item.str && "" !== item.str.trim())).map((item => {
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
                    }))
                }
            };
        }
        async process(canvas) {
            if (await ImmUtils.checkPaused(), "true" === canvas.dataset.ocrProcessed) return;
            let container = canvas.parentElement;
            container.classList.contains("ocr-container") || (container = document.createElement("div"), 
            container.classList.add("ocr-container"), container.style.position = "relative", 
            container.style.display = "inline-block", canvas.parentElement.insertBefore(container, canvas), 
            container.appendChild(canvas));
            const width = canvas.width, height = canvas.height;
            canvas.ocrBaseWidth = width, canvas.ocrBaseHeight = height;
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = width, tempCanvas.height = height;
            let result;
            if (tempCanvas.getContext("2d").drawImage(canvas, 0, 0, width, height), canvas.pdfTextContent) {
                if (result = PdfPageOCRStrategy.mapPdfTextToOcrResult(canvas.pdfTextContent.text, canvas.pdfTextContent.viewport), 
                !result) throw new Error("PDF Text mapping error");
            } else if (result = await this.adapter.recognize(tempCanvas, {}), !result) throw new Error("PDF OCR error");
            return await this._processOcrResult(canvas, container, null, result, 18);
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
    class PageTranslationCore {
        constructor(translationService, uiManager, options) {
            this.uiManager = uiManager, this.translationService = translationService, this.total = 0, 
            this.processed = 0, this.batchNodes = [], this.individualNodes = [], this.DELIMITER = options.delimiter || "[[BR]]", 
            this.BATCH_MAX_LENGTH = options.batchMaxLength || 1e3, this.NODE_DELIMITER = options.nodeDelimiter || "[[ND]]";
        }
        processPageState(body) {
            ImmUtils.storeOriginalTextNodes();
            const textNodes = ImmUtils.getTextNodes(document.body), total = textNodes.length;
            textNodes.forEach((node => {
                if ((!node.parentElement || !node.parentElement.classList.contains("translation-wrapper")) && node.parentNode) {
                    const wrapper = document.createElement("span");
                    if (wrapper.className = "translation-wrapper", node.parentNode.insertBefore(wrapper, node), 
                    wrapper.appendChild(node), !wrapper.querySelector(".text-spinner")) {
                        let spinner = document.createElement("span");
                        spinner.className = "text-spinner", wrapper.appendChild(spinner);
                    }
                }
            }));
            const batchNodes = [], individualNodes = [];
            for (const node of textNodes) node.nodeValue.length > this.BATCH_MAX_LENGTH ? individualNodes.push(node) : batchNodes.push(node);
            return this.total = total, this.batchNodes = batchNodes, this.individualNodes = individualNodes, 
            total;
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
            await Promise.all([ this.processBatchNodes(), this.processIndividualNodes() ]), 
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
            for (const node of this.batchNodes) {
                await ImmUtils.checkPaused();
                let parent = node.parentElement;
                if (parent) {
                    try {
                        let result = await this.translationService.translateText(node.nodeValue);
                        node.nodeValue = result, PageTranslationCore.removeSpinner(parent);
                    } catch (err) {
                        PageTranslationCore.removeSpinner(parent), PageTranslationCore.addRetryButton(parent, node, this.translationService?.translateText?.bind(this.translationService));
                    }
                    this.updateProgress();
                }
            }
        }
        async translateNodesBatch() {
            let batches = [], currentBatch = [], currentLength = 0;
            for (const node of this.batchNodes) {
                const text = node.nodeValue;
                currentLength + text.length > this.BATCH_MAX_LENGTH && currentBatch.length > 0 && (batches.push([ ...currentBatch ]), 
                currentBatch = [], currentLength = 0), currentBatch.push(node), currentLength += text.length;
            }
            currentBatch.length > 0 && batches.push([ ...currentBatch ]);
            for (const batch of batches) await this.translateBatchRecursively(batch);
        }
        async translateBatchRecursively(batch) {
            await ImmUtils.checkPaused();
            const combinedText = batch.map((node => node.nodeValue)).join(this.NODE_DELIMITER);
            let translatedCombined;
            try {
                translatedCombined = await this.translationService.translateText(combinedText);
            } catch (e) {
                if (1 === batch.length) {
                    let node = batch[0], parent = node.parentElement;
                    if (!parent) return;
                    try {
                        let result = await this.translationService.translateText(node.nodeValue);
                        return node.nodeValue = result, PageTranslationCore.removeSpinner(parent), void this.updateProgress();
                    } catch (err) {
                        return PageTranslationCore.removeSpinner(parent), void PageTranslationCore.addRetryButton(parent, node, this.translationService?.translateText?.bind(this.translationService));
                    }
                }
                const mid = Math.floor(batch.length / 2);
                return await this.translateBatchRecursively(batch.slice(0, mid)), void await this.translateBatchRecursively(batch.slice(mid));
            }
            let translatedParts = translatedCombined.split(/(?:(?:\|[ \t\r\n]*){0,4}A[ \t\r\n]*I[ \t\r\n]*L[ \t\r\n]*E[ \t\r\n]*N[ \t\r\n]*S(?:[ \t\r\n]*\|){0,4}|(?:\|[ \t\r\n]*){1,3}d?(?:[ \t\r\n]*\|){1,3})/gi);
            if (translatedParts.length !== batch.length && (translatedParts = translatedParts.filter(((part, index, arr) => 0 === index || ImmUtils.normalize(part) !== ImmUtils.normalize(arr[index - 1])))), 
            translatedParts.length !== batch.length) {
                if (1 === batch.length) {
                    let node = batch[0], parent = node.parentElement;
                    if (!parent) return;
                    parent.querySelector(".text-spinner");
                    try {
                        let result = await (this.translationService?.translateText(node.nodeValue));
                        return node.nodeValue = result, PageTranslationCore.removeSpinner(parent), void this.updateProgress();
                    } catch (err) {
                        return PageTranslationCore.removeSpinner(parent), void PageTranslationCore.addRetryButton(parent, node, this.translationService?.translateText?.bind(this.translationService));
                    }
                }
                const mid = Math.floor(batch.length / 2);
                return await this.translateBatchRecursively(batch.slice(0, mid)), void await this.translateBatchRecursively(batch.slice(mid));
            }
            for (let i = 0; i < batch.length; i++) {
                await ImmUtils.checkPaused();
                let parent = batch[i].parentElement;
                PageTranslationCore.removeSpinner(parent), PageTranslationCore.removeRetryButton(parent), 
                batch[i].nodeValue = ImmUtils.decodeHTMLEntities(translatedParts[i]), this.updateProgress();
            }
        }
        async processIndividualNodes() {
            for (const node of this.individualNodes) await ImmUtils.checkPaused(), await this.translateSingleNode(node);
        }
        async translateSingleNode(node) {
            let parent = node.parentElement;
            try {
                const translated = await (this.translationService?.translateText(node.nodeValue));
                node.nodeValue = translated, this.updateProgress(), PageTranslationCore.removeSpinner(parent);
            } catch (e) {
                PageTranslationCore.removeSpinner(parent), PageTranslationCore.addRetryButton(parent, node, this.translationService?.translateText?.bind(this.translationService));
            }
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
                await this.ocrManager.getOcrEngine().initEngine();
                const promises = [];
                let processed = 0;
                return images.forEach(((img, index) => {
                    "true" !== img.dataset.ocrProcessed && promises.push(Promise.race([ (async () => this.ocrManager.processContent(img).then((() => {
                        processed++, this.uiManager.updateFeedback(`Image (${processed}/${total})`);
                    })).catch((async error => (await ImmUtils.checkPaused(), Promise.resolve()))))(), new Promise(((_, reject) => {
                        const intervalId = setInterval((async () => {
                            ImmUtils.isCancelled() && (clearInterval(intervalId), await this.ocrManager.getOcrEngine().terminateEngine(), 
                            reject(new Error("Operation cancelled.")));
                        }), 50);
                    })) ]));
                })), await Promise.all(promises), await this.ocrManager.getOcrEngine().terminateEngine(), 
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
                    data: pdfData
                }).promise;
                let totalPages = pdfDoc.numPages;
                this.uiManager.updateFeedback(`(0/${totalPages})`, !0);
                let pageContainers = await this.uiManager.createPdfPages(pdfDoc);
                if (pageContainers.length !== totalPages) throw new Error("Errore nella creazione delle pagine PDF.");
                let processed = 0;
                Math.max(1, navigator.hardwareConcurrency - 1);
                await this.ocrManager.getOcrEngine().initEngine();
                for (let idx = 0; idx < pageContainers.length; idx++) {
                    await ImmUtils.checkPaused();
                    const canvas = pageContainers[idx].querySelector("canvas");
                    try {
                        await this.ocrManager.processContent(canvas), processed++, this.uiManager.updateFeedback(`(${processed}/${totalPages})`);
                    } catch (error) {
                        processed++, this.uiManager.updateFeedback(`Error on page ${idx + 1}`);
                    }
                    await ImmUtils.yieldControl();
                }
                await this.ocrManager.getOcrEngine().terminateEngine(), this.uiManager.updateFeedback("Done!", !1);
            } catch (e) {
                BaseUIManager.showNotification(`${e}`, "error");
            }
        }
        async stop(delay = 0) {
            this.uiManager.removeUI(delay);
            let hasError = !0;
            for (;hasError; ) {
                hasError = !1;
                document.querySelectorAll(".ocr-box").forEach((box => {
                    "[[ERROR]]" === JSON.parse(box.getAttribute("data-ocr-info")).translatedText && (hasError = !0);
                })), await new Promise((resolve => setTimeout(resolve, 5e3)));
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
        setCoreSettings(delimiter = "||d||", batchMaxLength = 1e3, nodeDelimiter = "|||AILENS|||") {
            return this.options.coreSettings = {
                delimiter: delimiter,
                batchMaxLength: batchMaxLength,
                nodeDelimiter: nodeDelimiter
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
    const namespace = "undefined" != typeof window ? window : "undefined" != typeof self ? self : globalThis;
    namespace.immTrans = namespace.immTrans || {}, namespace.immTrans.start = async function start(type = "page", downloadValue, pdfOCRValue, options = {}) {
        download = downloadValue, pdfOCR = pdfOCRValue;
        let o = (new OptionsBuilder).setCoreSettings().setTranslator(options?.translator).setTranslatorOptions(options?.translatorOptions).setQueueDelay(options?.queueDelay).setOCREngine(options?.ocrLanguages).build();
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
            !function addCSS() {
                const style = document.createElement("style");
                style.textContent = '\n        @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}@keyframes fadein{from{opacity:0!important;transform:translateY(-15px)}to{opacity:1!important;transform:translateY(0)}}@keyframes fadeout{from{opacity:1}to{opacity:0}}#translationContainer{position:fixed!important;bottom:20px!important;right:20px!important;display:flex!important;flex-direction:row!important;align-items:center!important;gap:8px!important;z-index:10000000!important;transition:transform 0.3s ease-in-out!important;transform-origin:right!important}#translationContainer.hidden{transform:translateX(68%)}#translationFeedbackBox{background:linear-gradient(135deg,rgb(44 62 80 / .95),rgb(52 73 94 / .85))!important;color:#fff!important;padding:16px 24px!important;border-radius:10px!important;font-family:\'Segoe UI\',Tahoma,Geneva,Verdana,sans-serif!important;font-size:16px!important;display:flex!important;max-width:90vw!important;align-items:center!important;box-shadow:0 6px 16px rgb(0 0 0 / .35)!important;backdrop-filter:blur(6px)!important;transition:transform 0.3s ease-in-out!important;transform-origin:right!important}.immTransl-arrow{width:24px;height:24px;cursor:pointer;transition:transform 0.3s ease;margin-right:12px;align-items:center;display:flex}#translationContainer.hidden .immTransl-arrow{transform:rotate(180deg)}#translationFeedbackBox .spinner{width:24px!important;height:24px!important;border:3px solid #fff!important;border-top:3px solid transparent!important;border-radius:50%!important;margin-right:12px!important;animation:spin 1s linear infinite}#notificationContainer{position:fixed!important;bottom:90px!important;right:20px!important;z-index:11000!important;display:flex!important;flex-direction:column!important;gap:10px!important;max-width:90vw!important}.notification{padding:12px 20px!important;border-radius:8px!important;color:#fff!important;font-family:Arial,sans-serif!important;font-size:16px!important;box-shadow:0 4px 12px rgb(0 0 0 / .2)!important;animation:fadein 0.5s ease-out!important}.notification.error{background-color:#e74c3c!important}.notification.warning{background-color:#f1c40f!important;color:#000!important}.notification.success{background-color:#2ecc71!important;color:#000!important}.notification.info{background-color:#3498db!important;color:#fff!important}.fade-out{animation:fadeout 0.5s forwards!important}@media (max-width:600px){#translationFeedbackBox,.notification{font-size:14px!important;padding:10px 16px!important}#translationFeedbackBox .spinner{width:16px!important;height:16px!important;margin-right:8px!important}}#translationControls{margin-left:12px!important;display:flex!important;gap:8px!important}.immTransl-control-btn{width:36px!important;height:36px!important;border:none!important;border-radius:50%!important;cursor:pointer!important;outline:none!important;display:flex!important;align-items:center!important;justify-content:center!important;color:#fff!important;font-size:14px!important;transition:background-color 0.2s ease,transform 0.1s ease!important}.immTransl-control-btn:hover{filter:brightness(1.2)!important}.immTransl-control-btn:active{transform:scale(.95)!important}.immTransl-control-btn.pause{background-color:#f1c40f!important}.immTransl-control-btn.resume{background-color:#2ecc71!important}.immTransl-control-btn.cancel{background-color:#e74c3c!important}.immTransl-control-btn.reset{background:linear-gradient(135deg,rgb(44 62 80 / .95),rgb(52 73 94 / .85))!important;box-shadow:0 6px 16px rgb(0 0 0 / .35)!important;backdrop-filter:blur(6px)!important;transition:background-color 0.3s ease,transform 0.1s ease!important;width:48px!important;height:48px!important}.immTransl-control-btn:disabled{opacity:0.5!important;cursor:not-allowed!important}@media (max-width:600px){#translationFeedbackBox,.notification{font-size:14px!important;padding:10px 16px!important}#translationFeedbackBox .spinner{width:16px!important;height:16px!important;margin-right:8px!important}}.translation-wrapper{position:relative;align-items:center}.text-spinner{display:inline-block;width:1em;height:1em;border:3px solid rgb(0 0 0 / .604);border-top:3px solid #fff0;border-radius:50%;animation:spin 1s linear infinite;margin-left:5px;flex:0 0 auto}.text-retry-button{width:1em;height:1em;background-color:#e53935;color:#fff;border:none;border-radius:4px;padding:10px;display:inline-flex;align-items:center;justify-content:center;font-weight:500;text-transform:uppercase;cursor:pointer;outline:none;box-shadow:0 3px 1px -2px rgb(0 0 0 / .2),0 2px 2px 0 rgb(0 0 0 / .14),0 1px 5px 0 rgb(0 0 0 / .12);transition:box-shadow 0.3s ease,background-color 0.3s ease;position:absolute;cursor:pointer;z-index:1000}.text-retry-button:hover{background-color:#d32f2f;box-shadow:0 5px 5px -3px rgb(0 0 0 / .2),0 8px 10px 1px rgb(0 0 0 / .14),0 3px 14px 2px rgb(0 0 0 / .12)}.text-retry-button:active{background-color:#c62828;box-shadow:0 2px 4px -1px rgb(0 0 0 / .2),0 4px 5px 0 rgb(0 0 0 / .14),0 1px 10px 0 rgb(0 0 0 / .12)}.text-retry-button::after{position:absolute;top:0;left:0;right:0;bottom:0;background:#fff0;z-index:9999}.ocr-overlay{position:absolute!important;color:#fff!important;font-family:\'Helvetica Neue\',Arial,sans-serif!important;text-shadow:0 1px 2px rgb(0 0 0 / .6)!important;padding:4px 8px!important;border-radius:0px!important;display:flex;align-items:center!important;justify-content:center!important;z-index:9999!important;transition:opacity 0.3s ease!important;opacity:0.95!important;overflow:hidden!important;white-space:pre-wrap!important}.ocr-box{position:absolute!important;left:var(--pos-x,0);top:var(--pos-y,0);width:var(--box-width,auto);height:var(--box-height,auto);transition:left 0.05s ease,top 0.05s ease;background:linear-gradient(135deg,rgb(44 62 80 / .95),rgb(52 73 94 / .85));box-shadow:8px 8px 11px rgb(0 0 0 / .1),0 1px 2px rgb(0 0 0 / .1)!important;color:#fff;font-weight:400!important;display:flex;justify-content:center!important;align-items:center!important;flex-direction:column!important;-webkit-overflow-scrolling:touch;-webkit-backdrop-filter:blur(40px)!important;-webkit-hyphens:auto!important;line-height:1.2em!important;box-sizing:border-box!important;word-break:break-word!important;word-wrap:break-word!important;letter-spacing:normal!important;border-radius:8px!important;font-family:\'Helvetica Neue\',Arial,sans-serif!important;text-align:left!important;padding:2px 4px!important;overflow:auto!important;white-space:normal!important;z-index:9999!important}.ocr-box-text{font-size:100%}.ocr-box-text::-webkit-scrollbar{-webkit-appearance:none;width:0;height:0}.ocr-box::-webkit-scrollbar{-webkit-appearance:none;width:0;height:0}.ocr-box.dragging{touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}#pdf-container.dragging{touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none}.ocr-box.ocr-box-error{background:linear-gradient(135deg,#f8e1e1,#fdf5f5);color:#a94442;box-shadow:0 4px 8px rgb(0 0 0 / .05);border-radius:8px;padding:0;overflow:hidden}.ocr-box.ocr-box-error:hover{transform:scale(1.02);box-shadow:0 8px 16px rgb(0 0 0 / .2)}.ocr-box .spinner{display:inline-block;width:auto;height:1em;aspect-ratio:1;border:3px solid rgb(255 255 255 / .1)!important;border-top:3px solid transparent!important;border-radius:50%!important;margin:auto!important;animation:spin 1s linear infinite}.ocr-box.ocr-box-error .ocr-retry-btn{display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#f44336;color:#fff;font-size:clamp(6px, 5vw, 24px);font-weight:500;border:none;outline:none;border-radius:4px;cursor:pointer;text-transform:uppercase;letter-spacing:.5px;position:relative;overflow:hidden;transition:background 0.3s,box-shadow 0.3s}.ocr-box.ocr-box-error .ocr-retry-btn:hover{background:#e53935;box-shadow:0 4px 8px rgb(0 0 0 / .3)}.ocr-box.ocr-box-error .ocr-retry-btn:active{background:#d32f2f;box-shadow:0 2px 4px rgb(0 0 0 / .2)}.ocr-box.ocr-box-error .ocr-retry-btn::after{content:"";position:absolute;top:50%;left:50%;width:5px;height:5px;background:rgb(255 255 255 / .5);opacity:0;border-radius:50%;transform:translate(-50%,-50%) scale(1);transition:width 0.6s ease-out,height 0.6s ease-out,opacity 0.6s ease-out}.ocr-box.ocr-box-error .ocr-retry-btn:active::after{width:120%;height:120%;opacity:0;transition:0s}.img-container{position:relative!important;display:inline-block!important}#pdf-viewer{position:relative;width:auto;height:95%;display:flex}#pdf-toolbar{position:fixed;top:10px;left:50%;transform:translateX(-50%);width:90%;max-width:600px;height:55px;background:rgb(44 62 80 / .7);backdrop-filter:blur(10px);border-radius:12px;color:#fff;display:flex;align-items:center;justify-content:space-between;z-index:1000000;box-shadow:0 4px 12px rgb(0 0 0 / .2);padding:0 15px;font-family:\'Segoe UI\',Tahoma,Geneva,Verdana,sans-serif}#pdf-toolbar button{background:rgb(255 255 255 / .2);border:none;color:#fff;padding:10px;margin:0 5px;border-radius:8px;font-size:18px;cursor:pointer;transition:all 0.3s ease-in-out;display:flex;align-items:center;justify-content:center;width:42px;height:42px}#pdf-toolbar button:hover{background:rgb(255 255 255 / .4)}#pdf-toolbar button:disabled{opacity:.5;cursor:not-allowed}#pdf-toolbar button i{font-size:22px}#pdf-toolbar span{font-size:18px;font-weight:700;text-align:center;flex-grow:1;padding:0 10px}.PDFtextLayer span{position:absolute!important}.PDFtextLayer{position:absolute;top:0;left:0;width:100%;height:100%}#pdf-container{margin-top:80px;flex:1;display:flex;flex-direction:column;gap:15px;overflow:visible;position:relative;margin:auto;width:95%}#pdf-container .ocr-container{position:relative;width:100%;box-shadow:0 0 6px rgb(0 0 0 / .2);overflow:hidden}#pdf-container canvas{width:100%!important;height:auto!important;display:block}#pdfOptionsOverlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgb(0 0 0 / .5);display:flex;align-items:center;justify-content:center;z-index:10000;padding:20px;animation:fadeIn 0.3s ease-in-out}@keyframes fadeIn{from{opacity:0}to{opacity:1}}#pdfOptionsModal{background:#f5f5f5;border-radius:8px;padding:20px;width:100%;max-width:400px;box-shadow:0 4px 12px rgb(0 0 0 / .15);font-family:Arial,sans-serif;opacity:0;transform:translateY(20px);animation:slideUp 0.4s forwards}@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}#pdfOptionsModal h2{margin-top:0;font-size:20px;color:#333;text-align:center;margin-bottom:20px}#pdfOptionsModal form>div{margin-bottom:15px}#pdfOptionsModal label{color:#333;font-size:14px;margin-left:8px}#pdfOptionsModal input[type="text"],#pdfOptionsModal input[type="number"]{width:calc(100% - 20px);padding:10px;margin-top:8px;border:1px solid #ccc;border-radius:4px;font-size:14px;transition:border-color 0.3s ease,box-shadow 0.3s ease}#pdfOptionsModal input[type="text"]:focus,#pdfOptionsModal input[type="number"]:focus{outline:none;border-color:#333;box-shadow:0 0 5px rgb(51 51 51 / .3)}#pdfOptionsModal input[type="radio"]{transform:scale(1.2);vertical-align:middle;margin-right:8px}#pdfOptionsModal .quality-container{display:flex;align-items:center;justify-content:center;gap:8px}#pdfOptionsModal .quality-container label{font-size:14px;color:#333}#pdfOptionsModal .quality-container input[type="range"]{flex:1;margin:0}#pdfOptionsModal .quality-container span{width:40px;text-align:center;font-size:14px;color:#333}#pdfOptionsModal input[type="range"]{-webkit-appearance:none;width:100%;height:6px;border-radius:3px;background:#ddd;outline:none;transition:background 0.3s}#pdfOptionsModal input[type="range"]::-webkit-slider-runnable-track{width:100%;height:6px;cursor:pointer;background:#ddd;border-radius:3px}#pdfOptionsModal input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:#333;cursor:pointer;transition:background 0.3s,transform 0.2s;margin-top:-7px}#pdfOptionsModal input[type="range"]::-webkit-slider-thumb:hover{background:#555;transform:scale(1.1)}@media (max-width:480px){#pdfOptionsModal .quality-container{flex-direction:column;align-items:center}#pdfOptionsModal .quality-container input[type="range"]{width:100%;margin:8px 0}#pdfOptionsModal .quality-container span{text-align:center}}#pdfOptionsModal .button-group{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}#pdfOptionsModal button{padding:10px 18px;font-size:14px;border:none;border-radius:4px;cursor:pointer;transition:background-color 0.3s ease,transform 0.2s ease}#pdfOptionsModal button#cancelPdfOptions{background:#ccc;color:#fff}#pdfOptionsModal button#cancelPdfOptions:hover{background:#b3b3b3;transform:scale(1.02)}#pdfOptionsModal button#confirmPdfOptions{background:#333;color:#fff}#pdfOptionsModal button#confirmPdfOptions:hover{background:#1a1a1a;transform:scale(1.02)}@media (max-width:480px){#pdfOptionsModal{padding:15px;max-width:90%}#pdfOptionsModal h2{font-size:18px}#pdfOptionsModal button{padding:10px;font-size:16px}#pdfOptionsModal button#confirmPdfOptions{flex:auto}}@media (max-width:600px){#pdf-toolbar{width:95%;max-width:95%;height:60px;padding:0 10px}#pdf-toolbar button{width:44px;height:44px}#pdf-toolbar button i{font-size:20px}#pdf-toolbar span{font-size:16px}#pdf-viewer{margin-top:90px}#pdf-toolbar #pageIndicator,#pdf-toolbar #zoomIndicator{font-size:14px}}@media (max-width:480px){.ocr-box{padding:1px 2px!important;border-radius:4px!important}.ocr-overlay{padding:2px 4px!important}}\n        ', 
                document.head.appendChild(style);
            }(), await Promise.all([ app.translatePage(), app.translateImages() ]), app.uiManager.updateFeedback("Done!", !1), 
            app.stop(5e3);
            break;

          case "image":
            await app.translateLocalImages(), app.uiManager.updateFeedback("Done!", !1), app.stop(5e3);
            break;

          case "pdf":
            await app.translatePdf(), app.stop(5e3);
            break;

          default:
            throw new Error("Invalid type");
        }
    };
}();