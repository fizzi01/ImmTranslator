/**
 * @license
 * RESTRICTED USE LICENSE
 * Copyright © 2025 Federico Izzi.
 * All rights reserved.
 * This source code and all its components are the exclusive property of Federico Izzi and are protected by copyright laws and international treaties. Any reproduction, copying, distribution, modification, decompilation, reverse engineering, or any other form of use, in whole or in part, is strictly prohibited without the prior written consent of the owner.
 * Unauthorized use of this code constitutes a violation of copyright and will be subject to legal action under applicable laws. No rights to exploit or license this code, whether express or implied, are granted except through a written agreement signed by Federico Izzi.
 * 
 * For permission requests or further inquiries, please contact:
 * 
 * - rugiade_cavigliere_2h@icloud.com
 * - https://github.com/fizzi01
 * 
 **/
(function () {
    let download;
    let pdfOCR;

    let translationPaused = false;
    let translationCanceled = false;
    let translationActive = true;
    let originalTextNodes = [];
    let trTextNodes = [];

    // ================================
    // ImmUtils
    // ================================
    class ImmUtils {

        static pauseTranslation() {
            translationPaused = true;
        }
        static resumeTranslation() {
            translationPaused = false;
        }

        static cancelTranslation() {
            translationCanceled = true;
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
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');
            return doc.documentElement.textContent;
        }

        static normalize(str) {
            return str.replace(/[^\p{L}\p{N}]/gu, "");
        }

        static base64ToUint8Array(base64) {
            const raw = atob(base64);
            const uint8Array = new Uint8Array(new ArrayBuffer(raw.length));
            for (let i = 0; i < raw.length; i++) {
                uint8Array[i] = raw.charCodeAt(i);
            }
            return uint8Array;
        }

        static getTextNodes(root) {
            const walker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: function (node) {
                        // Esclude nodi all'interno di tag non visualizzati
                        if (node.parentNode && ["SCRIPT", "STYLE", "NOSCRIPT"].includes(node.parentNode.tagName)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        // Esclude nodi che contengono solo spazi bianchi
                        if (!node.nodeValue.trim()) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );

            const nodes = [];
            let currentNode;
            while ((currentNode = walker.nextNode())) {
                nodes.push(currentNode);
            }
            return nodes;
        }

        static async checkPaused() {
            while (translationPaused && !translationCanceled) {
                await ImmUtils.sleep(100);
            }
            if (translationCanceled) {
                throw new Error("Translation canceled.");
            }
        }

        static isCancelled() {
            return translationCanceled;
        }

        static storeOriginalTextNodes() {
            if (originalTextNodes.length > 0) return;
            const nodes = ImmUtils.getTextNodes(document.body);
            for (const node of nodes) {
                originalTextNodes.push({ node: node, text: node.nodeValue });
            }
        }

        static storeTranslationNodes() {
            if (trTextNodes.length > 0) trTextNodes = [];
            const nodes = ImmUtils.getTextNodes(document.body);
            for (const node of nodes) {
                trTextNodes.push({ node: node, text: node.nodeValue });
            }
        }

        static observeCanvasResize(canvas) {
            // Manteniamo un registro degli observer per ogni canvas
            if (!window._canvasObservers) {
                window._canvasObservers = new WeakMap();
            }

            // Se esiste già un observer per questo canvas, lo rimuoviamo
            if (window._canvasObservers.has(canvas)) {
                window._canvasObservers.get(canvas).disconnect();
            }

            // Aggiungiamo un flag al canvas per controllare lo stato dell'observer
            canvas._observerPaused = false;

            const resizeObserver = new ResizeObserver(() => {
                // Controlla il flag prima di aggiornare l'overlay
                if (!canvas._observerPaused) {
                    OCRStrategy.updateOverlay(canvas, null, null, true);
                } else {
                    console.log("Observer evento ignorato (canvas in pausa)");
                }
            });

            resizeObserver.observe(canvas);
            window._canvasObservers.set(canvas, resizeObserver);
        }

        static pauseCanvasObserver(canvas) {
            console.log("Pausing observer for canvas:", canvas);
            // Imposta il flag di pausa
            canvas._observerPaused = true;

            if (window._canvasObservers && window._canvasObservers.has(canvas)) {
                window._canvasObservers.get(canvas).disconnect();
                return true;
            }
            return false;
        }

        static resumeCanvasObserver(canvas) {
            console.log("Resuming observer for canvas:", canvas);

            if (window._canvasObservers && window._canvasObservers.has(canvas)) {
                // Ripristina l'osservazione
                const observer = window._canvasObservers.get(canvas);
                observer.observe(canvas);

                // Rimuove il flag di pausa solo DOPO aver riattivato l'observer
                // per evitare attivazioni immediate durante la transizione
                setTimeout(() => {
                    canvas._observerPaused = false;
                }, 50);

                return true;
            }
            return false;
        }

        static resetTranslation(notificationCallback = () => { }, feedbackCallback = () => { }) {
            if (translationActive) {
                if (!pdfOCR) {
                    ImmUtils.storeTranslationNodes();
                }
                feedbackCallback("Reset", false);
                for (const entry of originalTextNodes) {
                    entry.node.nodeValue = entry.text;
                }

                document.querySelectorAll('.ocr-box').forEach(box => {
                    box.style.display = 'none';
                });

                notificationCallback("Translation Reset", "success");
                translationActive = false;
            }
            else {
                for (const entry of trTextNodes) {
                    if (entry.text) {
                        entry.node.nodeValue = entry.text;
                    }
                }
                document.querySelectorAll('.ocr-box').forEach(box => {
                    box.style.display = 'flex';
                    OCRStrategy.adjustFontSize(box);
                });
                notificationCallback("Translation Restored", "success");
                translationActive = true;
            }
        }

    }

    // ================================
    // Commands and Facades
    // ================================
    class Command {
        execute(options) {
            throw new Error("Metodo execute() non implementato.");
        }
    }

    class ExportPdfCommand extends Command {
        constructor(pdfExporter) {
            super();
            this.pdfExporter = pdfExporter;
        }

        async execute(options, logFunction) {
            try {
                await this.pdfExporter.export(options, logFunction);
            } catch (error) {
                console.error("Errore durante l'export PDF:", error);
                throw error
            }
        }
    }

    class ProcessPdfPageCommand extends Command {
        constructor() {
            super();
        }

        async execute(pdfDoc, pageNum) {
            try {
                console.log("Processing page", pageNum);
                return await ProcessPdfPageFacede.processPage(pdfDoc, pageNum);
            } catch (error) {
                console.error("Errore durante l'elaborazione della pagina PDF:", error);
                throw error;
            }
        }
    }

    class ExportImageCommand extends Command {
        constructor(imageExporter) {
            super();
            this.imageExporter = imageExporter;
        }

        async execute(options, logFunction) {
            try {
                await this.imageExporter.export(options, logFunction);
            } catch (error) {
                console.error("Errore durante l'export immagine:", error);
                throw error;
            }
        }
    }

    class PdfExporterFacade {

        static async processVerticalBox(box) {
            // Clona il box
            const clone = box.cloneNode(true);

            // Crea un container off-screen
            const offscreen = document.createElement('div');
            offscreen.style.position = 'fixed';
            offscreen.style.left = '-9999px';
            offscreen.style.top = '-9999px';
            offscreen.style.opacity = '0';
            document.body.appendChild(offscreen);
            offscreen.appendChild(clone);

            // Misura il box originale
            const rect = box.getBoundingClientRect();
            // Per "orizzontale" vogliamo invertire le dimensioni:
            // il clone dovrà avere width pari all'altezza originale e height pari alla larghezza originale.
            clone.style.writingMode = 'horizontal-tb'; // rimuove l'effetto verticale
            clone.style.transform = 'none'; // rimuove eventuali rotazioni
            clone.style.width = rect.height + 'px';
            clone.style.height = rect.width + 'px';

            // Attende il reflow
            await new Promise(resolve => requestAnimationFrame(resolve));

            // Cattura il clone con html2canvas
            const canvas = await html2canvas(clone, {
                scale: 2,
                backgroundColor: null
            });
            const dataUrl = canvas.toDataURL("image/png", 1.0);

            // Pulisce il container off-screen
            offscreen.remove();

            // Restituisce la PNG e le dimensioni "orizzontali" del clone
            return {
                dataUrl,
                cloneWidth: rect.height,  // larghezza "orizzontale"
                cloneHeight: rect.width   // altezza "orizzontale"
            };
        }

        async export(options, logFunction) {
            try {
                const containers = document.querySelectorAll(".ocr-container");
                if (containers.length === 0) {
                    console.error("Nessun container trovato.");
                    return;
                }

                const pdfViewer = document.getElementById('pdf-viewer');
                let currentZoomFactor = 1.0;
                if (pdfViewer && pdfViewer.style.transform) {
                    const match = pdfViewer.style.transform.match(/scale\(([\d.]+)\)/);
                    if (match && match[1]) {
                        currentZoomFactor = parseFloat(match[1]);
                    }
                }

                console.log("PDF Options:", options);

                // Imposta le dimensioni della pagina basandoti sul primo canvas trovato
                const firstCanvas = containers[0].querySelector("canvas[data-ocr-processed='true']");
                if (!firstCanvas) throw new Error("No translations found");


                pdfViewer.style.transform = 'scale(1)';

                //Disable zoomIn and zoomOut buttons
                const zoomInButton = document.getElementById('zoomIn');
                const zoomOutButton = document.getElementById('zoomOut');
                if (zoomInButton) zoomInButton.disabled = true;
                if (zoomOutButton) zoomOutButton.disabled = true;

                //Wait to scale have effect
                await ImmUtils.sleep(500);


                const pageWidth = firstCanvas.offsetWidth;
                const pageHeight = firstCanvas.offsetHeight;
                const orientation = pageWidth > pageHeight ? 'landscape' : 'portrait';

                const { jsPDF } = window.jspdf;
                // Crea il documento PDF con le dimensioni del canvas
                const pdf = new jsPDF({
                    orientation: orientation,
                    unit: 'px',
                    format: [pageWidth, pageHeight]
                });

                logFunction(`⏳ Processing your PDF ⏳`, "success");

                // Determina quali pagine processare in base alle opzioni selezionate
                let pagesToProcess = [];
                if (options.type === 'all') {
                    pagesToProcess = Array.from({ length: containers.length }, (_, i) => i);
                } else if (options.type === 'specific') {
                    // Le pagine vengono considerate 1-indexed dall'utente
                    pagesToProcess = options.pages.map(p => p - 1).filter(i => i >= 0 && i < containers.length);
                } else if (options.type === 'range') {
                    const start = options.range.start - 1;
                    const end = options.range.end - 1;
                    pagesToProcess = [];
                    for (let i = start; i <= end && i < containers.length; i++) {
                        pagesToProcess.push(i);
                    }
                }

                // Processa le pagine selezionate
                for (let index = 0; index < pagesToProcess.length; index++) {
                    const i = pagesToProcess[index];
                    const container = containers[i];
                    let tCanvas = container.querySelector("canvas[data-ocr-processed='true']");
                    if (tCanvas) OCRStrategy.updateOverlay(tCanvas);
                    if (!tCanvas) {
                        tCanvas = container.querySelector("canvas");
                    }
                    const iPageWidth = tCanvas?.offsetWidth || pageWidth;
                    const iPageHeight = tCanvas?.offsetHeight || pageHeight;
                    const iOrientation = pageWidth > pageHeight ? 'landscape' : 'portrait';

                    const backupStyles = [];
                    const verticalBoxes = [];
                    // Assicura che gli stili dei box siano applicati correttamente
                    container.querySelectorAll('.ocr-box').forEach((box, idx) => {
                        const computed = getComputedStyle(box);
                        backupStyles[idx] = {
                            background: computed.background,
                            backgroundColor: computed.backgroundColor,
                            boxShadow: computed.boxShadow,
                            overflow: computed.overflow,
                            height: computed.height,
                            maxHeight: computed.maxHeight,
                            padding: computed.padding,
                        };
                        // Apply styles with !important to ensure they override any inline styles
                        box.style.boxShadow = 'none !important';
                        box.style.overflow = 'visible';
                        box.style.border = 'none !important';
                        box.style.fontFamily = computed.fontFamily;
                        box.style.fontSize = computed.fontSize;
                        box.style.color = computed.color;
                        box.style.padding = computed.padding;
                        box.style.margin = computed.margin;
                        box.style.writingMode = computed.writingMode;

                        // Force style rendering by triggering reflow
                        void box.offsetWidth;

                        // Check for vertical text either by writing-mode or by 90/-90 degree rotation
                        // Check for vertical text by writing-mode or rotation matrices
                        if (computed.writingMode === 'vertical-rl' ||
                            (computed.transform && (
                                // Check for matrices that represent 90/-90/270 degree rotations
                                computed.transform === 'matrix(0, 1, -1, 0, 0, 0)' || // 90deg
                                computed.transform === 'matrix(0, -1, 1, 0, 0, 0)' || // -90deg/270deg
                                computed.transform.includes('rotate(90') ||
                                computed.transform.includes('rotate(-90') ||
                                computed.transform.includes('rotate(270')
                            ))) {
                            verticalBoxes.push(box);
                        } else {// Rimossi perchè si applicava un transform strano :D
                            //box.style.transform = computed.transform;
                            //box.style.transformOrigin = computed.transformOrigin;
                        }

                        // Bisogna nascondere anche i resize handler ovvero div con calssName che inizia con "resize-handle"
                        const resizeHandles = box.querySelectorAll("[class^='resize-handle']");
                        for (const handle of resizeHandles) {
                            handle.style.display = 'none';
                        }
                    });

                    const tempImages = [];
                    for (const box of verticalBoxes) {
                        const { dataUrl, cloneWidth, cloneHeight } = await PdfExporterFacade.processVerticalBox(box);
                        const computed = getComputedStyle(box);
                        const left = parseFloat(computed.left) + cloneHeight;
                        const top = parseFloat(computed.top);

                        const img = new Image();
                        img.src = dataUrl;
                        img.style.position = 'absolute';
                        // Imposta le dimensioni in base al clone (che sono invertite rispetto al box originale)
                        img.style.width = cloneWidth + 'px';
                        img.style.height = cloneHeight + 'px';
                        img.setAttribute("width", cloneWidth * 2);
                        img.setAttribute("height", cloneHeight * 2);
                        // Posiziona l'immagine in corrispondenza della posizione del box originale
                        img.style.left = left + 'px';
                        img.style.top = top + 'px';
                        // Applica la rotazione per ripristinare l'effetto verticale:
                        if (box.style.writingMode === 'vertical-rl') {
                            img.style.transform = 'rotate(90deg)';
                            img.style.transformOrigin = 'top left';
                        } else {
                            img.style.left = left - cloneHeight + 'px';
                            img.style.transform = box.style.transform;
                            img.style.transformOrigin = "bottom left";
                        }
                        img.style.zIndex = '1000';

                        container.appendChild(img);
                        tempImages.push({ box, img });
                        // Nascondi il box originale
                        box.style.display = 'none';
                    }

                    logFunction(`Preparing translated page ${i + 1}`, "warning");

                    // ---- Gestione del canvas di background ----

                    let originalCanvas = container.querySelector("canvas[data-ocr-processed='true']");
                    if (!originalCanvas) {
                        originalCanvas = container.querySelector("canvas");
                    }

                    // ---- Sostituisci il canvas con un'immagine temporanea per il rendering ----
                    const bgImg = new Image();
                    // Usa il contenuto ripristinato del canvas come fonte
                    bgImg.src = originalCanvas.toDataURL("image/png");
                    bgImg.style.width = iPageWidth + "px";
                    bgImg.style.height = iPageHeight + "px";
                    bgImg.setAttribute("width", iPageWidth);
                    bgImg.setAttribute("height", iPageHeight);
                    bgImg.style.position = 'absolute';
                    bgImg.style.top = '0';
                    bgImg.style.left = '0';
                    bgImg.style.zIndex = '999';
                    bgImg.style.display = 'block';

                    // Nascondi il canvas e inserisci l'immagine temporanea
                    container.insertBefore(bgImg, container.firstChild);

                    // Renderizza il container con html2canvas
                    const canvasRendered = await html2canvas(container, {
                        width: iPageWidth,
                        height: iPageHeight,
                        windowWidth: iPageWidth,
                        windowHeight: iPageHeight,
                    });
                    const imgData = canvasRendered.toDataURL("image/jpeg", options.quality);

                    // Cleanup
                    bgImg.remove();

                    container.querySelectorAll('.ocr-box').forEach((box, idx) => {
                        const backup = backupStyles[idx];
                        if (!backup) return;
                        box.style.background = backup.background;
                        box.style.backgroundColor = backup.backgroundColor;
                        box.style.boxShadow = backup.boxShadow;
                        box.style.overflow = backup.overflow;
                        box.style.height = backup.height;
                        box.style.maxHeight = backup.maxHeight;
                        box.style.padding = backup.padding;
                        const resizeHandles = box.querySelectorAll("[class^='resize-handle']");
                        for (const handle of resizeHandles) {
                            handle.style.display = '';
                        }
                    });

                    for (const { box, img } of tempImages) {
                        box.style.display = '';
                        img.remove();
                    }

                    if (index > 0) {
                        pdf.addPage([iPageWidth, iPageHeight], iOrientation);
                        pdf.internal.pageSize.width = iPageWidth;
                        pdf.internal.pageSize.height = iPageHeight;
                        pdf.internal.pageSize.orientation = iOrientation;
                    }
                    pdf.addImage(imgData, 'JPEG', 0, 0, iPageWidth, iPageHeight);

                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                pdfViewer.style.transform = 'scale(' + currentZoomFactor + ')';
                if (zoomInButton) zoomInButton.disabled = false;
                if (zoomOutButton) zoomOutButton.disabled = false;

                logFunction(`PDF Ready ✅`, "success");
                const name = fileName ? fileName : "PDF";
                pdf.save(`${name}_translated.pdf`);
            } catch (error) {

                throw error;
            }
        }
    }

    class ProcessPdfPageFacede {
        static async processPage(pdfDoc, pageNum) {

            const page = await pdfDoc.getPage(pageNum);

            let scale = 2;

            const viewport = page.getViewport({ scale, dontFlip: false });

            // Crea il canvas per la pagina
            const canvas = document.createElement("canvas");

            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.width = viewport.width + "px";
            canvas.style.height = viewport.height + "px";
            canvas.crossOrigin = "anonymous";
            canvas.style.zIndex = "1";
            const context = canvas.getContext("2d");

            // Crea il container per la pagina
            const pageContainer = document.createElement("div");
            pageContainer.classList.add("ocr-container");
            pageContainer.style.position = "relative";
            pageContainer.style.display = "inline-block";
            //pageContainer.style.marginBottom = "20px";

            // Renderizza la pagina sul canvas
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            const textPage = await page.getTextContent();
            console.log("Text Page:", textPage);

            //Aggancio i dati testo alla pagina
            if (textPage.items.length > 0) canvas.pdfTextContent = { text: textPage, viewport: viewport };

            pageContainer.appendChild(canvas);

            const pdfContainer = document.getElementById("pdf-container");
            pdfContainer.appendChild(pageContainer);

            ImmUtils.observeCanvasResize(canvas);

            return pageContainer;
        }
    }

    class ImageExporterFacade {

        static restoreImageOverlay() {
            try {
                const container = document.getElementById("imageContainer");

                // 1) Rimuovi l'overlay <img>
                const overlayImg = document.getElementById("overlayCanvasImage");
                if (overlayImg) {
                    overlayImg.remove();
                }

                // 2) Ri-mostra gli .ocr-box
                container.querySelectorAll('.ocr-box').forEach(box => {
                    box.style.display = '';
                });

                // 3) Riabilita #downloadPdf
                const pdfButton = document.getElementById("downloadPdf");
                if (pdfButton) {
                    pdfButton.disabled = false;
                }

            } catch (err) {
                console.error("Errore nel ripristino:", err);
            }
        }

        static async processVerticalBox(box) {
            // Clona il box
            const clone = box.cloneNode(true);

            // Crea un container off-screen
            const offscreen = document.createElement('div');
            offscreen.style.position = 'fixed';
            offscreen.style.left = '-9999px';
            offscreen.style.top = '-9999px';
            offscreen.style.opacity = '0';
            document.body.appendChild(offscreen);
            offscreen.appendChild(clone);

            // Misura il box originale
            const rect = box.getBoundingClientRect();
            // Per "orizzontale" vogliamo invertire le dimensioni:
            // il clone dovrà avere width pari all'altezza originale e height pari alla larghezza originale.
            clone.style.writingMode = 'horizontal-tb'; // rimuove l'effetto verticale
            clone.style.transform = 'none'; // rimuove eventuali rotazioni
            clone.style.width = rect.height + 'px';
            clone.style.height = rect.width + 'px';

            // Attende il reflow
            await new Promise(resolve => requestAnimationFrame(resolve));

            // Cattura il clone con html2canvas
            const canvas = await html2canvas(clone, {
                scale: 2,
                backgroundColor: null
            });
            const dataUrl = canvas.toDataURL("image/png", 1.0);

            // Pulisce il container off-screen
            offscreen.remove();

            // Restituisce la PNG e le dimensioni "orizzontali" del clone
            return {
                dataUrl,
                cloneWidth: rect.height,  // larghezza "orizzontale"
                cloneHeight: rect.width   // altezza "orizzontale"
            };
        }

        async export(options, logFunction) {
            try {
                //Ottieni div di class ocr-container
                const container = document.querySelectorAll('.ocr-container')[1];

                // 1) Backup stili
                const backupOverflow = container.style.overflow;
                const backupHeight = container.style.height;
                const backupBackground = container.style.background;

                // 2) Disabilita overflow e imposta altezza “auto”
                container.style.overflow = 'visible';
                container.style.height = 'auto';

                //Recupero le dimensioni di offset dell'immagine
                const base64Image = document.getElementById("base64Image");
                if (!base64Image) {
                    logFunction("No image found", "error");
                    return;
                }
                const rect = base64Image.getBoundingClientRect();
                console.log("Rect:", rect);
                let pageWidth = rect.width;
                let pageHeight = rect.height;
                container.style.width = pageWidth + "px";
                container.style.height = pageHeight + "px";

                logFunction(`Preparing image ...`, "warning");

                const verticalBoxes = [];
                // Applica eventuali stili "finali" ai box, come fa la funzione pdf (se serve)
                container.querySelectorAll('.ocr-box').forEach(box => {
                    const computed = getComputedStyle(box);
                    // Imposta stili come background, font, ecc.
                    box.style.background = computed.background;
                    box.style.backgroundColor = computed.backgroundColor;
                    box.style.border = computed.border;
                    box.style.fontFamily = computed.fontFamily;
                    box.style.fontSize = computed.fontSize;
                    box.style.color = computed.color;
                    box.style.padding = computed.padding;
                    box.style.margin = computed.margin;
                    box.style.boxShadow = computed.boxShadow;
                    if (computed.writingMode === 'vertical-rl') {
                        verticalBoxes.push(box);
                    }
                });

                const tempImages = [];
                for (const box of verticalBoxes) {
                    const { dataUrl, cloneWidth, cloneHeight } = await ImageExporterFacade.processVerticalBox(box);
                    const computed = getComputedStyle(box);
                    const left = parseFloat(computed.left) + cloneHeight;
                    const top = parseFloat(computed.top);

                    const img = new Image();
                    img.src = dataUrl;
                    img.style.position = 'absolute';
                    // Imposta le dimensioni in base al clone (che sono invertite rispetto al box originale)
                    img.style.width = cloneWidth + 'px';
                    img.style.height = cloneHeight + 'px';
                    // Posiziona l'immagine in corrispondenza della posizione del box originale
                    img.style.left = left + 'px';
                    img.style.top = top + 'px';
                    // Applica la rotazione per ripristinare l'effetto verticale:
                    // (Ruotando di 90° la PNG "orizzontale" la rendiamo verticalmente disposta)
                    img.style.transform = 'rotate(90deg)';
                    img.style.transformOrigin = 'top left';
                    img.style.zIndex = '1000';

                    container.appendChild(img);
                    tempImages.push({ box, img });
                    // Nascondi il box originale
                    box.style.display = 'none';
                }

                const imageUri = base64Image.src;

                const viewportScale = window.visualViewport ? window.visualViewport.scale : 1;
                const bgImg = new Image();
                if (viewportScale !== 1) {
                    // Usa il contenuto ripristinato del canvas come fonte
                    bgImg.src = imageUri;
                    bgImg.style.width = pageWidth + "px";
                    bgImg.style.height = pageHeight + "px";
                    bgImg.style.width = "100%";
                    bgImg.style.height = "100%";
                    //bgImg.style.objectFit = "cover"; // oppure "contain" se preferisci che l'intera immagine sia visibile
                    //bgImg.style.objectPosition = "center";
                    bgImg.setAttribute("width", pageWidth);
                    bgImg.setAttribute("height", pageHeight);
                    bgImg.style.position = 'absolute';
                    bgImg.style.top = '0';
                    bgImg.style.left = '0';
                    bgImg.style.zIndex = '999';
                    bgImg.style.display = 'block';

                    // Nascondi il canvas e inserisci l'immagine temporanea
                    container.insertBefore(bgImg, container.firstChild);
                }

                // Richiama html2canvas per catturare immagine + overlay
                const renderedCanvas = await html2canvas(container, {
                    useCORS: true,
                    allowTaint: false,
                    ...(viewportScale !== 1 && {
                        width: pageWidth,
                        height: pageHeight,
                        windowWidth: pageWidth,
                        windowHeight: pageHeight,
                    }),
                });
                const imgData = renderedCanvas.toDataURL('image/png', options.quality);
                if (viewportScale !== 1) {
                    bgImg?.remove();
                }

                for (const { box, img } of tempImages) {
                    box.style.display = '';
                    img.remove();
                }

                container.style.overflow = backupOverflow;
                container.style.height = backupHeight;
                container.style.background = backupBackground;

                if (download) {
                    logFunction(`Image Ready ✅`, "success");
                    const link = document.createElement("a");
                    link.href = imgData;
                    link.download = `${fileName}_translated.png`;

                    link.addEventListener('error', () => {
                        logFunction("Download canceled", "warning");
                    });
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);

                } else {

                    let overlayImg = document.getElementById("overlayCanvasImage");
                    if (!overlayImg) {
                        overlayImg = document.createElement("img");
                        overlayImg.id = "overlayCanvasImage";
                        // Impostiamo CSS da JS: deve stare sopra la vecchia immagine
                        // e adattarsi alle dimensioni del contenitore
                        overlayImg.style.position = "absolute";
                        overlayImg.style.top = "0";
                        overlayImg.style.left = "0";
                        overlayImg.style.width = "100%";
                        overlayImg.style.height = "auto";
                        overlayImg.style.zIndex = "9998";
                        container.appendChild(overlayImg);
                    }

                    overlayImg.src = imgData;
                    overlayImg.style.display = "block";

                    // 4) Nascondiamo tutti gli ocr-box
                    container.querySelectorAll('.ocr-box').forEach(box => {
                        box.style.display = 'none';
                    });

                    // 5) Disabilitiamo il pulsante #downloadPdf
                    const button = document.getElementById("downloadPdf");
                    if (button) {
                        button.disabled = true;
                    }

                    const headerButtons = document.querySelector(".headerButtons");
                    if (headerButtons) {
                        // Se esiste già un pulsante, rimuovilo per sicurezza (evita duplicati)
                        const existingEditBtn = document.getElementById("editTranslationButton");
                        if (existingEditBtn) existingEditBtn.remove();

                        // Creiamo dinamicamente il pulsante
                        const editBtn = document.createElement("button");
                        editBtn.id = "editTranslationButton";
                        editBtn.className = "modernButton";
                        editBtn.textContent = "Edit translation";

                        // On click: ripristina e rimuove se stesso
                        editBtn.onclick = function () {
                            ImageExporterFacade.restoreImageOverlay();
                            editBtn.remove();
                        };

                        // Lo aggiungiamo a fianco
                        headerButtons.appendChild(editBtn);
                    }

                    logFunction(`Image Ready ✅`, "success", 4000);
                    logFunction(`Hold the image to download it!`, "info", 10000);

                }
            } catch (error) {
                console.error("Errore nella conversione in immagine:", error);
            }
        }
    }

    // ================================
    // Facade per la traduzione
    // ================================
    class TranslationService {
        constructor(translator, type, queueDelay = 1000, worker) {
            this.translator = translator; // config
            this.worker = worker;
            this.pendingWorkerRequests = {};
            this.queueDelay = queueDelay;
            this.type = type;
        }

        initWorker() {
            console.log("Initializing worker");
            this.worker.postMessage({
                action: 'init',
                config: {
                    apiKey: this.translator.apiKey,
                    openAiUrl: this.translator.openAiUrl,
                    model: this.translator.model,
                    temperature: this.translator.temperature,
                    targetLang: this.translator.targetLang,
                    prompt: this.translator.prompt,
                    type: this.type,
                    callDelay: this.queueDelay,
                }
            });


            this.worker.addEventListener("message", (e) => {
                if (e.data.type === "debug") {
                    console.log("DEBUG dal worker:", ...e.data.args);
                }
                const data = e.data;
                if (data.requestId && this.pendingWorkerRequests[data.requestId]) {
                    if (data.status === 'success') {
                        console.log("[WORKER] Translation success:", data.translation);
                        this.pendingWorkerRequests[data.requestId].resolve(data.translation);
                    } else {
                        this.pendingWorkerRequests[data.requestId].reject(new Error(data.error));
                    }
                    delete this.pendingWorkerRequests[data.requestId];
                }
            });
        }

        stopWorker() {
            console.log("Stopping worker");
            this.worker.terminate();
            this.worker = null;
            this.pendingWorkerRequests = {};
        }

        async translateText(text) {
            return new Promise((resolve, reject) => {
                const requestId = 'req_' + crypto.randomUUID();
                this.pendingWorkerRequests[requestId] = { resolve, reject };
                console.log("Translation request:", requestId);
                this.worker.postMessage({ action: 'translateText', text, requestId });
            });
        }

    }

    // ================================
    // NotificationManager
    // ================================
    class NotificationManager {
        constructor() {
            this.container = null;
            if (!NotificationManager.instance) {
                this.container = this._createContainer();
                this.maxNotifications = 3;
                NotificationManager.instance = this;
            }
            return NotificationManager.instance;
        }
        setMaxNotifications(max) {
            this.maxNotifications = max;
        }

        _createContainer() {
            let container = document.getElementById('notificationContainer');
            if (!container) {
                container = document.createElement('div');
                container.id = 'notificationContainer';
                document.body.appendChild(container);
            }
            return container;
        }

        showNotification(message, severity = 'error', duration = 2000) {
            const notification = document.createElement('div');

            if (!this.container) {
                this.container = this._createContainer();
            }

            while (this.container.children.length >= this.maxNotifications) {
                this.container.removeChild(this.container.firstChild);
            }

            notification.className = `notification ${severity}`;
            notification.textContent = message;
            this.container.appendChild(notification);
            setTimeout(() => {
                notification.classList.add('fade-out');
                notification.addEventListener('animationend', () => notification.remove());
            }, duration);
        }
    }

    // ================================
    // UIManager
    // ================================
    class BaseUIManager {
        constructor() {
            this.notificationManager = new NotificationManager();
            this.created = false;
            this.removed = false;
        }

        initUI() {
            if (this.created) return;

            const container = this.createTranslationContainer();
            if (container && !document.getElementById('resetButton')) {
                container.appendChild(this._createResetButton());
            }

            if (!document.getElementById('translationFeedbackBox')) {
                container.appendChild(this.createFeedbackBox());
            }

            setTimeout(() => {
                if (container) {
                    container.classList.add('hidden');
                }
            }, 1000);

            this.created = true;
        }

        removeUI(duration = 2000) {
            if (this.removed) return;

            document.getElementById('translationContainer').classList.remove('hidden');
            const box = document.getElementById('translationFeedbackBox');
            setTimeout(() => {
                box.classList.add('fade-out');
                box.addEventListener('animationend', () => {
                    box.remove();
                    document.getElementById('translationContainer').classList.remove('hidden');
                });
            }, duration);

            this.removed = true;
        }

        _createResetButton() {
            const resetBtn = document.createElement('button');
            resetBtn.className = 'immTransl-control-btn reset';
            resetBtn.title = 'Reset';
            resetBtn.id = 'resetButton';
            resetBtn.innerHTML = '<svg version="1.0" xmlns="http://www.w3.org/2000/svg" \
     width="24.000000pt" height="24.000000pt" viewBox="0 0 512.000000 512.000000" \
     preserveAspectRatio="xMidYMid meet"> \
    <g transform="translate(0.000000,512.000000) scale(0.100000,-0.100000)" \
    fill="#fff" stroke="none"> \
    <path d="M2390 4794 c-441 -40 -832 -189 -1180 -448 -123 -91 -346 -315 -436 \
    -436 -229 -308 -373 -652 -431 -1030 -24 -158 -24 -482 0 -640 50 -325 167 \
    -635 341 -900 98 -149 164 -230 300 -366 344 -343 765 -554 1256 -630 159 -25 \
    481 -25 640 0 825 127 1497 673 1784 1450 55 148 49 224 -23 289 -46 41 -68 \
    49 -229 82 -128 26 -162 25 -222 -6 -60 -30 -97 -79 -139 -183 -145 -354 -401 \
    -644 -726 -822 -726 -395 -1636 -169 -2097 520 -367 549 -355 1274 30 1816 86 \
    121 251 286 372 372 169 120 400 223 592 262 439 90 826 4 1190 -266 l80 -60 \
    -181 -182 c-116 -118 -187 -197 -197 -222 -53 -124 21 -267 151 -294 34 -7 \
    256 -10 661 -8 l609 3 45 25 c24 14 58 45 75 68 l30 44 3 646 2 646 -26 53 \
    c-33 69 -103 113 -180 113 -87 0 -130 -30 -343 -244 l-194 -194 -76 60 c-308 \
    246 -651 403 -1011 463 -92 16 -379 27 -470 19z"/> \
    </g> \
    </svg>';
            resetBtn.disabled = false;
            resetBtn.addEventListener('click', (b) => {
                ImmUtils.resetTranslation(BaseUIManager.showNotification, this.updateFeedback);
                b.remove;
            });
            return resetBtn;
        }

        _createControlButtons() {
            const controlContainer = document.createElement('div');
            controlContainer.id = 'translationControls';

            const pauseBtn = document.createElement('button');
            pauseBtn.className = 'immTransl-control-btn pause';
            pauseBtn.title = 'Pause';
            pauseBtn.innerHTML = '<svg version="1.0" xmlns="http://www.w3.org/2000/svg" width="12.000000pt" height="12.000000pt" viewBox="0 0 512.000000 512.000000" preserveAspectRatio="xMidYMid meet">\
    <g transform="translate(0.000000,512.000000) scale(0.100000,-0.100000)" fill="#fff" stroke="none">\
    <path d="M774 5104 c-16 -8 -39 -29 -50 -47 -19 -31 -19 -71 -19 -2497 0 -2429 0 -2465 20 -2497 38 -64 23 -63 660 -63 631 0 622 -1 662 58 17 26 18 131 18 2502 0 2371 -1 2476 -18 2502 -40 59 -31 58 -664 58 -494 0 -582 -3 -609 -16z"/>\
    <path d="M3123 5104 c-18 -9 -40 -28 -50 -43 -17 -25 -18 -135 -18 -2501 0 -2371 1 -2476 18 -2502 40 -59 31 -58 662 -58 637 0 622 -1 660 63 20 32 20 \
    68 20 2497 0 2429 0 2465 -20 2497 -38 64 -23 63 -662 63 -506 0 -582 -2 -610 -16z"/></g></svg>\
    '; pauseBtn.disabled = false;

            const resumeBtn = document.createElement('button');
            resumeBtn.className = 'immTransl-control-btn resume';
            resumeBtn.title = 'Resume';
            resumeBtn.innerHTML = '<svg version="1.0" xmlns="http://www.w3.org/2000/svg" \
      // width="12pt" height="12pt" viewBox="0 0 512.000000 512.000000"\
     preserveAspectRatio="xMidYMid meet">\
    <g transform="translate(0.000000,512.000000) scale(0.100000,-0.100000)"\
    fill="#fff" stroke="none">\
    <path d="M620 5110 c-71 -15 -151 -60 -206 -115 -86 -85 -137 -210 -154 -375\
    -13 -129 -13 -3991 0 -4120 17 -165 68 -290 154 -375 149 -149 373 -163 619\
    -39 76 37 3457 1975 3546 2031 31 20 90 70 131 112 159 161 196 340 107 521\
    -37 76 -152 198 -238 253 -89 56 -3470 1994 -3546 2031 -37 19 -97 44 -133 56\
    -74 24 -214 34 -280 20z"/>\
    </g>\
    </svg>';
            resumeBtn.disabled = true;

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'immTransl-control-btn cancel';
            cancelBtn.title = 'Cancel';
            cancelBtn.innerHTML = '<svg version="1.0" xmlns="http://www.w3.org/2000/svg" \
     width="12.000000pt" height="12.000000pt" viewBox="0 0 512.000000 512.000000" \
     preserveAspectRatio="xMidYMid meet"> \
    <g transform="translate(0.000000,512.000000) scale(0.100000,-0.100000)" \
    fill="#fff" stroke="none"> \
    <path d="M579 5107 c-26 -7 -68 -27 -95 -45 -58 -37 -401 -381 -431 -432 -36 \
    -60 -56 -147 -49 -212 14 -133 -28 -86 888 -1003 461 -462 838 -847 838 -855 \
    0 -8 -377 -393 -838 -855 -911 -912 -873 -869 -888 -997 -8 -72 17 -169 61 \
    -233 19 -28 117 -132 217 -231 223 -221 254 -239 393 -239 164 1 96 -57 1044 \
    891 458 459 838 833 843 832 6 -2 385 -378 842 -835 944 -944 878 -887 1041 \
    -888 139 0 170 18 393 239 100 99 198 203 217 231 44 64 69 161 61 233 -15 \
    128 23 85 -888 997 -461 462 -838 847 -838 855 0 8 377 393 838 855 911 912 \
    873 869 888 997 8 72 -17 169 -61 233 -19 28 -117 132 -217 231 -223 221 -254 \
    239 -393 239 -163 -1 -97 56 -1042 -889 -457 -457 -837 -831 -843 -831 -7 0 \
    -386 374 -844 831 -741 741 -837 835 -890 859 -70 32 -177 42 -247 22z"/> \
    </g> \
    </svg>';
            cancelBtn.disabled = false;

            // Gestione click per il bottone Pausa
            pauseBtn.addEventListener('click', () => {
                if (!translationPaused) {
                    translationPaused = true;
                    this.updateFeedback("Translation Paused", false);
                    pauseBtn.disabled = true;
                    resumeBtn.disabled = false;
                }
            });

            // Gestione click per il bottone Riprendi
            resumeBtn.addEventListener('click', () => {
                if (translationPaused) {
                    translationPaused = false;
                    this.updateFeedback("Translation Resumed", true);
                    resumeBtn.disabled = true;
                    pauseBtn.disabled = false;
                }
            });

            // Gestione click per il bottone Annulla:
            // Quando viene premuto, si aggiorna il messaggio, si disabilitano i pulsanti e si rimuove immediatamente il box.
            cancelBtn.addEventListener('click', () => {
                if (!translationCanceled) {
                    translationCanceled = true;
                    this.updateFeedback("Translation Canceled", false);
                    pauseBtn.disabled = true;
                    resumeBtn.disabled = true;
                    cancelBtn.disabled = true;
                    this.removeFeedback(0);
                    if (download) {
                        document.getElementById("downloadPdf").disabled = false;
                    }
                    document.querySelectorAll('.text-spinner, .text-retry-button').forEach(el => el.remove());
                }
            });

            controlContainer.appendChild(pauseBtn);
            controlContainer.appendChild(resumeBtn);
            controlContainer.appendChild(cancelBtn);

            return controlContainer;
        }

        createTranslationContainer() {
            if (!document.getElementById('translationContainer')) {
                const container = document.createElement('div');
                container.id = 'translationContainer';
                container.style.position = 'fixed';
                container.style.bottom = '20px';
                container.style.right = '20px';
                container.style.display = 'flex';
                container.style.alignItems = 'center';
                container.style.gap = '8px';
                document.body.appendChild(container);
                return container;
            }
        }

        createFeedbackBox() {
            let box = document.getElementById('translationFeedbackBox');
            if (!box) {
                box = document.createElement('div');
                box.id = 'translationFeedbackBox';
                // Creazione della struttura interna: freccia, spinner, testo, pulsanti di controllo
                const arrow = document.createElement('div');
                arrow.className = 'immTransl-arrow';
                arrow.innerHTML = `<svg version="1.0" xmlns="http://www.w3.org/2000/svg"
             width="32.000000pt" height="32.000000pt" viewBox="0 0 512.000000 512.000000"
             preserveAspectRatio="xMidYMid meet">
            <g transform="translate(0.000000,512.000000) scale(0.100000,-0.100000)"
            fill="#fff" stroke="none">
            <path d="M1400 5098 c-44 -17 -77 -44 -171 -137 -144 -143 -163 -177 -164
            -286 0 -58 5 -91 19 -120 13 -27 333 -355 995 -1018 l976 -977 -977 -978
            c-760 -760 -982 -987 -997 -1022 -14 -30 -21 -67 -21 -110 0 -103 29 -153 168
            -291 98 -97 127 -119 175 -137 73 -28 131 -28 204 -1 56 20 108 71 1230 1193
            1297 1296 1223 1214 1223 1346 0 132 74 50 -1223 1346 -1123 1123 -1174 1173
            -1230 1193 -72 26 -136 26 -207 -1z"/>
            </g>
            </svg>
              `;
                arrow.addEventListener('click', function (e) {
                    e.stopPropagation();
                    document.getElementById('translationContainer').classList.toggle('hidden');
                });
                box.appendChild(arrow);

                const spinner = document.createElement('div');
                spinner.className = 'spinner';
                spinner.addEventListener('click', function (e) {
                    e.stopPropagation();
                    box.classList.toggle('hidden');
                });
                box.appendChild(spinner);

                const text = document.createElement('span');
                text.id = 'feedbackText';
                text.textContent = 'Starting translation...';
                box.appendChild(text);

                box.appendChild(this._createControlButtons());

                document.body.appendChild(box);
            }
            return box;
        }

        updateFeedback(message, showSpinner = true) {
            const box = document.getElementById('translationFeedbackBox');
            if (box) {
                const text = document.getElementById('feedbackText');
                if (text) text.textContent = message;
                const spinner = box.querySelector('.spinner');
                if (spinner) spinner.style.display = showSpinner ? 'block' : 'none';
            }
            //await new Promise(resolve => requestAnimationFrame(resolve));
        }

        removeFeedback(delay = 2000) {
            document.getElementById('translationContainer').classList.remove('hidden');
            const box = document.getElementById('translationFeedbackBox');
            setTimeout(() => {
                box.classList.add('fade-out');
                box.addEventListener('animationend', () => {
                    box.remove();
                    document.getElementById('translationContainer').classList.remove('hidden');
                });
            }, delay);
        }

        static showNotification(message, severity, duration) {
            let notificationManager = new NotificationManager();
            notificationManager.showNotification(message, severity, duration);
        }
    }

    class PDFUIManager extends BaseUIManager {
        constructor() {
            super();
            this.currentPageIndex = 0;
            this.totalPages = 0;
            this.pageContainers = [];
            this.zoomFactor = 1.0;  // Fattore di zoom iniziale
            this.zoomStep = 0.1;    // Incremento/decremento dello zoom per ogni click
            this.minZoom = 0.1;     // Zoom minimo
            this.maxZoom = 2.0;     // Zoom massimo
            this.panzoom = null;
        }

        static showNotification(message, severity, duration) {
            super.showNotification(message, severity, duration);
        }

        initUI() {
            this.buildPdfViewer();
            super.initUI();
        }

        removeUI(duration) {
            if (download) {
                PDFUIManager.enableDownloadButton();
            }
            super.removeUI(duration);
        }

        async exportPdfCallback() {
            const containers = document.querySelectorAll(".ocr-container");
            if (containers.length === 0) {
                console.error("Nessun container trovato.");
                return;
            }
            const maxPages = containers.length;
            const options = await PDFUIManager.showPdfOptionsModal(maxPages);

            const pdfExporter = new PdfExporterFacade();
            const exportCommand = new ExportPdfCommand(pdfExporter);

            try {
                await exportCommand.execute(options, PDFUIManager.showNotification);
            } catch (error) {
                PDFUIManager.showNotification(error, "error");
            }

        }

        buildPdfViewer() {
            let viewer = document.getElementById('pdf-viewer');
            if (!viewer) {
                viewer = document.createElement('div');
                viewer.id = 'pdf-viewer';
                document.body.appendChild(viewer);
            }

            let toolbar = document.getElementById('pdf-toolbar');
            if (!toolbar) {
                toolbar = document.createElement('div');
                toolbar.id = 'pdf-toolbar';
                toolbar.innerHTML = `
            <button id="prevPage"><i class="fas fa-arrow-left"></i></button>
            <span id="pageIndicator">0 of 0</span>
            <button id="nextPage"><i class="fas fa-arrow-right"></i></button>
   
            <button id="zoomOut"><i class="fas fa-search-minus"></i></button>
            <span id="zoomIndicator">100%</span>
            <button id="zoomIn"><i class="fas fa-search-plus"></i></button>

            <button id="downloadPdf" disabled><i class="fas fa-download"></i></button>
          `;
                document.body.appendChild(toolbar);
            }

            let pdfContainer = document.getElementById('pdf-container');
            if (!pdfContainer) {
                pdfContainer = document.createElement('div');
                pdfContainer.id = 'pdf-container';
                viewer.appendChild(pdfContainer);
            }

            const downloadBtn = document.getElementById("downloadPdf");
            downloadBtn.addEventListener("click", this.exportPdfCallback);
        }

        static async showPdfOptionsModal(maxPages) {
            return new Promise((resolve, reject) => {
                // Check if a modal is already open
                if (document.getElementById("pdfOptionsOverlay")) {
                    //reject("Modal is already open.");
                    return;
                }

                // Crea l'overlay e il modal
                const overlay = document.createElement("div");
                overlay.id = "pdfOptionsOverlay";

                const modal = document.createElement("div");
                modal.id = "pdfOptionsModal";
                modal.innerHTML = `
          <h2>PDF Options</h2>
          <form id="pdfOptionsForm">
            <div>
              <input type="radio" id="optionAll" name="pdfOption" value="all" checked>
              <label for="optionAll">Entire PDF</label>
            </div>
            <div>
              <input type="radio" id="optionSpecific" name="pdfOption" value="specific">
              <label for="optionSpecific">Specific Pages</label>
              <input type="text" id="specificPages" placeholder="e.g. 1,3,5" disabled>
            </div>
            <div>
              <input type="radio" id="optionRange" name="pdfOption" value="range">
              <label for="optionRange">Page Range</label>
              <div style="display: flex; gap: 10px; margin-top: 8px;">
                <input type="number" id="rangeStart" placeholder="From" disabled>
                <input type="number" id="rangeEnd" placeholder="To" disabled>
              </div>
            </div>
            <div class="quality-container">
              <label for="pdfQuality">PDF Quality (Optimal 70%):</label>
              <input type="range" id="pdfQuality" min="10" max="100" value="70" style="vertical-align: middle; margin: 0 8px;">
              <span id="pdfQualityValue">70%</span>
            </div>
            <div class="button-group">
              <button type="button" id="cancelPdfOptions">Cancel</button>
              <button type="submit" id="confirmPdfOptions">Download</button>
            </div>
          </form>
          `;

                overlay.appendChild(modal);
                document.body.appendChild(overlay);

                const pdfQualitySlider = modal.querySelector("#pdfQuality");
                const pdfQualityValue = modal.querySelector("#pdfQualityValue");
                pdfQualitySlider.addEventListener("input", () => {
                    pdfQualityValue.textContent = pdfQualitySlider.value + "%";
                });

                // Gestione abilitazione/disabilitazione input in base all'opzione selezionata
                const specificPagesInput = modal.querySelector("#specificPages");
                const rangeStartInput = modal.querySelector("#rangeStart");
                const rangeEndInput = modal.querySelector("#rangeEnd");

                rangeStartInput.setAttribute("min", "1");
                rangeStartInput.setAttribute("max", maxPages);
                rangeEndInput.setAttribute("min", "1");
                rangeEndInput.setAttribute("max", maxPages);

                const radios = modal.querySelectorAll('input[name="pdfOption"]');
                radios.forEach(radio => {
                    radio.addEventListener("change", () => {
                        specificPagesInput.disabled = !modal.querySelector("#optionSpecific").checked;
                        rangeStartInput.disabled = !modal.querySelector("#optionRange").checked;
                        rangeEndInput.disabled = !modal.querySelector("#optionRange").checked;
                    });
                });

                // Gestione submit del form
                const form = modal.querySelector("#pdfOptionsForm");
                form.addEventListener("submit", (e) => {
                    e.preventDefault();
                    const selectedOption = modal.querySelector('input[name="pdfOption"]:checked').value;
                    const quality = modal.querySelector("#pdfQuality").value / 100;
                    const result = { type: selectedOption, quality: quality };

                    if (selectedOption === "range") {
                        const start = parseInt(rangeStartInput.value);
                        const end = parseInt(rangeEndInput.value);
                        if (isNaN(start) || isNaN(end)) {
                            alert("Please enter valid numbers for the range.");
                            return;
                        }
                        if (start < 1 || end < 1 || start > maxPages || end > maxPages) {
                            alert(`The range must be between 1 and ${maxPages}.`);
                            return;
                        }
                        if (start > end) {
                            alert("The starting page cannot be greater than the ending page.");
                            return; s
                        }
                        result.range = { start, end };
                    } else if (selectedOption === "specific") {
                        let pages = specificPagesInput.value
                            .split(",")
                            .map(num => parseInt(num.trim()))
                            .filter(num => !isNaN(num));
                        if (pages.length === 0) {
                            alert("Please enter at least one valid page number.");
                            return;
                        }
                        const invalidPages = pages.filter(page => page < 1 || page > maxPages);
                        if (invalidPages.length > 0) {
                            alert(`All page numbers must be between 1 and ${maxPages}.`);
                            return;
                        }
                        result.pages = pages;
                    }
                    document.body.removeChild(overlay);
                    resolve(result);
                });

                // Gestione pulsante annulla
                const cancelBtn = modal.querySelector("#cancelPdfOptions");
                cancelBtn.addEventListener("click", () => {
                    document.body.removeChild(overlay);
                });
            });
        }

        applyZoom() {
            const pdf_viewer = document.getElementById('pdf-viewer');
            if (!pdf_viewer) return;

            // Rettangolo del pdf_viewer in coordinate viewport
            const viewerRect = pdf_viewer.getBoundingClientRect();

            // Calcola l'intersezione tra la viewport e il pdf_viewer (porzione visibile)
            const visibleLeft = Math.max(viewerRect.left, 0);
            const visibleTop = Math.max(viewerRect.top, 0);
            const visibleRight = Math.min(viewerRect.right, window.innerWidth);
            const visibleBottom = Math.min(viewerRect.bottom, window.innerHeight);

            // Centro della porzione visibile (del viewer) in coordinate viewport
            const visibleCenterX = (visibleLeft + visibleRight) / 2;
            const visibleCenterY = (visibleTop + visibleBottom) / 2;

            // Converti il centro visibile in coordinate documento
            const viewportCenterX = window.scrollX + visibleCenterX;
            const viewportCenterY = window.scrollY + visibleCenterY;

            // Ottieni la posizione del pdf_viewer in coordinate documento
            const viewerLeft = viewerRect.left + window.scrollX;
            const viewerTop = viewerRect.top + window.scrollY;

            // Calcola la posizione relativa del centro visibile rispetto al top-left del viewer
            const relativeCenterX = viewportCenterX - viewerLeft;
            const relativeCenterY = viewportCenterY - viewerTop;

            const oldZoom = this.zoomFactorOld || 1.0;
            const newZoom = this.zoomFactor;

            // Coordinate "contenutistiche" (non scalate) basate sul vecchio zoom
            const contentX = relativeCenterX / oldZoom;
            const contentY = relativeCenterY / oldZoom;

            pdf_viewer.style.transition = "transform 0.05s ease";

            if (newZoom < 1) {
                // Per zoom out vogliamo che il viewer, che si rimpicciolisce, resti centrato sulla pagina corrente
                const preIndex = this.currentPageIndex;

                pdf_viewer.style.transformOrigin = "top center";
                pdf_viewer.style.transform = `scale(${newZoom})`;
                const newCenterX = viewerLeft + contentX * newZoom;
                const newCenterY = viewerTop + contentY * newZoom;
                const newScrollX = newCenterX - window.innerWidth / 2;
                const newScrollY = newCenterY - window.innerHeight / 2;

                // Use smooth scrolling for a better experience
                window.scrollTo({
                    //left: newScrollX,
                    top: newScrollY,
                });

            } else {
                // Per zoom in (newZoom >= 1): usa origin top-left e calcola lo scroll in base al centro della porzione visibile globale.
                pdf_viewer.style.transformOrigin = "top left";
                pdf_viewer.style.transform = `scale(${newZoom})`;

                const newCenterX = viewerLeft + contentX * newZoom;
                const newCenterY = viewerTop + contentY * newZoom;
                const newScrollX = newCenterX - window.innerWidth / 2;
                const newScrollY = newCenterY - window.innerHeight / 2;

                // Use smooth scrolling for a better experience
                window.scrollTo({
                    left: newScrollX,
                    top: newScrollY,
                });
            }

            // Aggiorna il vecchio zoom per le operazioni successive
            this.zoomFactorOld = newZoom;
        }

        updateOcrBoxesForZoom(container) {
            // Recupera tutti i box OCR nel container
            const boxes = container.querySelectorAll('.ocr-box');
            if (boxes.length === 0) return;

            const canvas = container.querySelector("canvas");
            if (!canvas || !canvas.ocrData) return;

            OCRStrategy.updateOverlay(canvas, null, null);
        }

        zoomIn() {
            if (this.zoomFactor < this.maxZoom) {
                this.zoomFactor = Math.min(this.maxZoom, this.zoomFactor + this.zoomStep);
                this.applyZoom();
                this.updateZoomIndicator();

            }
        }

        zoomOut() {
            if (this.zoomFactor > this.minZoom) {
                const oldZoom = this.zoomFactor;
                this.zoomFactor = Math.max(this.minZoom, this.zoomFactor - this.zoomStep);
                this.applyZoom();
                this.updateZoomIndicator();

            }
        }


        updateZoomIndicator() {
            const indicator = document.getElementById("zoomIndicator");
            const percentage = Math.round(this.zoomFactor * 100);
            indicator.textContent = `${percentage}%`;
        }

        updatePageIndicator() {
            const indicator = document.getElementById("pageIndicator");
            indicator.textContent = `${this.currentPageIndex + 1} of ${this.totalPages}`;
        }

        showCurrentPage() {
            this.pageContainers.forEach((container, index) => {
                container.style.display = "block";
            });
            //this.updatePageIndicator();
            if (this.pageContainers[this.currentPageIndex]) {
                this.pageContainers[this.currentPageIndex].scrollIntoView({ behavior: "smooth", block: "start" });
                const currentCanvas = this.pageContainers[this.currentPageIndex].querySelector("canvas");
                //TODO: Maybe remove this !! Teoricamente non è corretto stia qui cosi servirebbe astrazione
                /*
                if (currentCanvas && currentCanvas.ocrData) {
                    requestAnimationFrame(() => {
                        OCRStrategy.updateOverlay(currentCanvas);
                    });
                }
                */
            }
        }

        addToolbarListeners(pdfDoc, worker, translator, scale) {
            const pdfContainer = document.getElementById("pdf-container");

            document.getElementById("prevPage").addEventListener("click", async () => {
                if (this.currentPageIndex > 0) {
                    this.currentPageIndex--;
                    this.showCurrentPage();
                }
            });

            document.getElementById("nextPage").addEventListener("click", () => {
                if (this.currentPageIndex < this.totalPages - 1) {
                    this.currentPageIndex++;
                    this.showCurrentPage();
                }
            });

            document.getElementById("zoomIn").addEventListener("click", () => {
                this.zoomIn();
            });

            document.getElementById("zoomOut").addEventListener("click", () => {
                this.zoomOut();
            });

        }

        async createPdfPages(pdfDoc) {
            this.totalPages = pdfDoc.numPages;

            const pageProcessor = new ProcessPdfPageFacede();
            const processCommand = new ProcessPdfPageCommand(pageProcessor);

            const calculateDynamicThreshold = () => {
                // Ottieni la larghezza della viewport
                const viewportWidth = window.innerWidth;

                // Calcola una soglia che diminuisce all'aumentare delle dimensioni dello schermo
                // Ad esempio: da 0.5 (50%) per schermi piccoli a 0.15 (15%) per schermi grandi
                if (viewportWidth <= 600) {
                    return 0.5; // Dispositivi mobili: soglia più alta
                } else if (viewportWidth <= 1200) {
                    return 0.35; // Tablet e laptop: soglia media
                } else if (viewportWidth <= 1800) {
                    return 0.25; // Desktop: soglia più bassa
                } else {
                    return 0.15; // Schermi molto grandi: soglia minima
                }
            };

            const dynamicThresholds = [0, 0.15, 0.25, 0.35, 0.5, 0.75, 1.0];
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    // Usa la soglia calcolata dinamicamente
                    const requiredVisibility = calculateDynamicThreshold();

                    if (entry.isIntersecting && (entry.intersectionRatio * this.zoomFactor) >= requiredVisibility) {
                        this.currentPageIndex = Array.from(this.pageContainers).indexOf(entry.target);
                        this.updatePageIndicator();
                    }
                });
            }, {
                root: null,
                threshold: dynamicThresholds,
                rootMargin: '0px'
            });

            this.pageContainers = [];
            for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
                console.log("Processing page", pageNum);
                const container = await processCommand.execute(pdfDoc, pageNum);
                this.pageContainers.push(container);
                observer.observe(container)
            }

            this.currentPageIndex = 0;
            this.showCurrentPage();
            this.addToolbarListeners();
            this.updateZoomIndicator();

            return this.pageContainers;
        }

        static enableDownloadButton() {
            document.getElementById("downloadPdf").disabled = false;
        }

        static disableDownloadButton() {
            document.getElementById("downloadPdf").disabled = true;
        }
    }

    class ImageUIManager extends BaseUIManager {
        constructor() {
            super();
        }

        initUI() {
            if (this.created) return;
            super.initUI();
            this._loadBase64Image();
            //Attach download button event
            document.getElementById("downloadPdf").addEventListener("click", this.exportImageCallback.bind(this));
        }

        removeUI(duration) {
            if (this.removed) return;
            super.removeUI(duration);
            ImageUIManager.enableDownloadButton();
        }

        static enableDownloadButton() {
            document.getElementById("downloadPdf").disabled = false;
        }

        static disableDownloadButton() {
            document.getElementById("downloadPdf").disabled = true;
        }

        exportImageCallback() {
            console.log("Exporting image...");
            const options = { quality: 1.0 };
            const exporter = new ImageExporterFacade();
            const exportCommand = new ExportImageCommand(exporter);

            try {
                exportCommand.execute(options, BaseUIManager.showNotification);
            }
            catch (error) {
                BaseUIManager.showNotification(error, "error");
            }
        }

        _loadBase64Image() {
            try {
                const imgElement = document.getElementById("base64Image");
                console.log(imgElement);
                const base64String = `data:image/${fileType};base64,${base64Data.data}`;
                imgElement.src = base64String;
                imgElement.alt = fileName;
                ImmUtils.observeCanvasResize(imgElement);
            } catch (error) {
                console.error("Errore caricando immagine base64:", error);
            }
        }

    }


    // ================================
    // Factory per UIManager
    // ================================
    class UIManagerFactory {
        static createUIManager(type) {
            switch (type) {
                case 'pdf':
                    return new PDFUIManager();
                case 'image':
                    return new ImageUIManager();
                case 'page':
                    return new BaseUIManager();
                default:
                    return new BaseUIManager();
            }
        }
    }

    // ================================
    // OCREngine and TesseractAdapter
    // ================================
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
        constructor(languages = 'eng', tesseractOptions = null) {
            super();
            this.worker = null;
            this.languages = languages;
            this.tesseractOptions = tesseractOptions;
        }

        async initEngine() {
            this.worker = await Tesseract.createWorker(this.languages);
            if (this.tesseractOptions) {
                await this.worker.setParameters(this.tesseractOptions);
            }
        }

        async terminateEngine() {
            if (this.worker) {
                await this.worker.terminate();
            }
        }

        async recognize(element, options) {
            // Incapsula l'interfaccia di Tesseract
            const extraOptions = {
                ...options,
                lang: this.languages
            };
            return await this.worker?.recognize(element, extraOptions, { blocks: true });
        }
    }

    // ================================
    // OCRStrategy
    // ================================
    class OCRStrategy {
        constructor(adapter, translator) {
            this.adapter = adapter;
            this.translator = translator;
            this._overlayUpdateScheduled = false;
            // Funzione debounce per l'update (aggiornamento ogni 100ms)
            this.debouncedUpdate = OCRStrategy.debounce((element, tempCanvas, iElementData) => {
                OCRStrategy.updateOverlay(element, tempCanvas, iElementData);
                this._overlayUpdateScheduled = false;
            }, 100);
        }
        async process(element) {
            throw new Error("Metodo process() non implementato in OCRStrategy");
        }

        static adjustFontSize(box) {
            const handles = box.querySelectorAll('.resize-handle');
            const handleDisplays = [];
            handles.forEach(handle => {
                handleDisplays.push(handle.style.display);
                handle.style.display = 'none';
            });

            const minFontSize = 0.00001;
            const maxFontSize = 30;
            let low = minFontSize;
            let high = maxFontSize;
            let fontSize;

            const iterations = 10;
            for (let i = 0; i < iterations; i++) {
                fontSize = (low + high) / 2;
                box.style.fontSize = fontSize + 'px';

                if (box.scrollHeight <= box.clientHeight) {
                    low = fontSize;
                } else {
                    high = fontSize;
                }
            }
            box.style.fontSize = low + 'px';

            let idx = 0;
            handles.forEach(handle => {
                handle.style.display = handleDisplays[idx++];
            });
        }

        static retryOcrBoxTranslation(img, idx) {

            const translator = img.ocrTranslator;
            if (!translator) {
                console.error("Translator function not found for retry");
                return;
            }

            if (!img.ocrData) {
                console.error("Invalid OCR block idx for retry", idx);
                return;
            }

            img.ocrData[idx].translatedText = '';
            OCRStrategy.updateOverlay(img);
            translator.translateText(img.ocrData[idx].originalText.replace(/<br>/gi, '[[BR]]'))
                .then(translatedText => {
                    const finalText = ImmUtils.decodeHTMLEntities(translatedText).replace(/\[\[BR\]\]/g, '<br>');
                    img.ocrData[idx].translatedText = finalText;
                    OCRStrategy.updateOverlay(img);
                })
                .catch(e => {
                    console.error("Retry failed for OCR block", idx, e);
                    img.ocrData[idx].translatedText = "[[ERROR]]";
                    OCRStrategy.updateOverlay(img);
                });
        }

        static sampleMedianColor(ctx, x, y, width, height) {
            // Ottieni i dati della patch
            const data = ctx.getImageData(x, y, width, height).data;
            const rValues = [];
            const gValues = [];
            const bValues = [];
            const aValues = [];

            for (let i = 0; i < data.length; i += 4) {
                rValues.push(data[i]);
                gValues.push(data[i + 1]);
                bValues.push(data[i + 2]);
                aValues.push(data[i + 3]);
            }

            // Funzione che calcola la mediana di un array
            function median(values) {
                values.sort((a, b) => a - b);
                const mid = Math.floor(values.length / 2);
                if (values.length % 2 === 0) {
                    return (values[mid - 1] + values[mid]) / 2;
                }
                return values[mid];
            }

            return {
                r: median(rValues),
                g: median(gValues),
                b: median(bValues),
                a: median(aValues)
            };
        }

        static getCtxFromElement(el, corsFreeCanvas = null) {
            if (!el) return null;

            if (corsFreeCanvas) {
                return corsFreeCanvas.getContext('2d');
            }

            // Se l'elemento è un canvas, restituisce il suo contesto 2d
            if (typeof el.getContext === "function") {
                return el.getContext('2d');
            }

            return null;
        }

        static updateBoxesInChunks(element, boxes, offsetX, offsetY, zoomFactor, corsFreeCanvas, lastTranslatedIndex) {
            if (lastTranslatedIndex !== null && lastTranslatedIndex !== undefined && lastTranslatedIndex >= 0 && lastTranslatedIndex < boxes.length) {
                const box = boxes[lastTranslatedIndex];
                const data = element.ocrData[lastTranslatedIndex];
                if (data) {
                    updateBox(box, data, lastTranslatedIndex);
                }
                return;
            }

            const chunkSize = 5;
            let currentIndex = 0;

            function updateChunk() {
                for (let j = 0; j < chunkSize && currentIndex < boxes.length; j++, currentIndex++) {
                    const box = boxes[currentIndex];
                    const data = element.ocrData[currentIndex];
                    if (!data) continue;

                    updateBox(box, data, -1); // -1 indica che stiamo aggiornando tutto
                }

                if (currentIndex < boxes.length) {
                    requestAnimationFrame(updateChunk);
                }
            }

            function updateBox(box, data, boxIndex) {
                console.log("[DEBUG] Processing box, zoom", zoomFactor);

                const html = box.innerHTML.trim();

                const { bbox, translatedText, baseline } = data;
                const x = offsetX + bbox.x0 * zoomFactor;
                const y = offsetY + bbox.y0 * zoomFactor;
                const boxWidth = (bbox.x1 - bbox.x0) * zoomFactor;
                const boxHeight = (bbox.y1 - bbox.y0) * zoomFactor;

                box.style.position = 'absolute';
                box.style.left = x + 'px';
                box.style.top = y + 'px';
                box.style.width = boxWidth + 'px';
                box.style.height = boxHeight + 'px';

                if (boxIndex === -1 &&
                    (html.includes('class="spinner"') || html.includes('ocr-retry-btn'))) {
                    return;
                }

                if (!translatedText || translatedText === "") {
                    box.innerHTML = `<div class="spinner"></div>`;
                    box.classList.remove("ocr-box-error");
                    box.style.cursor = 'default';
                    box.contentEditable = "false";
                } else if (translatedText === "[[ERROR]]") {
                    box.classList.add("ocr-box-error");
                    box.innerHTML = `<button class="ocr-retry-btn">↻</button>`;
                    box.style.cursor = 'pointer';
                    box.contentEditable = "false";
                    box.onclick = function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        OCRStrategy.retryOcrBoxTranslation(element, box.dataset.index);
                    };
                } else {
                    if (!box.querySelector('.ocr-box-text')) {
                        box.classList.remove("ocr-box-error");
                        box.innerHTML = "<div class='ocr-box-text'>" + translatedText + "</div>";
                        OCRStrategy.calculateBoxColor(data, element, corsFreeCanvas, bbox, box, parseInt(box.dataset.index));
                    }
                }

                // Skip font adjustment for boxes that don't need it
                if (
                    (boxIndex === -1 && // se è un aggiornamento globale
                        html !== "" &&
                        !html.includes('class="spinner"') &&
                        !html.includes('ocr-retry-btn'))
                ) {
                    try {
                        OCRStrategy.adjustFontSize(box);
                    } catch (e) {
                        console.error(e);
                    }
                    return; // Skip the rest of the processing
                }

                let angleDeg = 0;
                let isVertical = false;
                let dx = 0, dy = 0;
                if (baseline && baseline.x0 !== undefined && baseline.y0 !== undefined &&
                    baseline.x1 !== undefined && baseline.y1 !== undefined && bbox) {
                    dx = baseline.x1 - baseline.x0;
                    dy = baseline.y1 - baseline.y0;
                    const L = Math.sqrt(dx * dx + dy * dy);
                    const threshold = L * Math.cos(80 * Math.PI / 180);
                    if (Math.abs(dx) < threshold) {
                        const bw = bbox.x1 - bbox.x0;
                        const bh = bbox.y1 - bbox.y0;
                        isVertical = true;
                        if (bh < bw * 1.5) {
                            angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
                            if (angleDeg > 90) {
                                angleDeg -= 180;
                            } else if (angleDeg < -90) {
                                angleDeg += 180;
                            }
                        }

                    } else {
                        angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
                        if (angleDeg > 90) {
                            angleDeg -= 180;
                        } else if (angleDeg < -90) {
                            angleDeg += 180;
                        }
                    }
                }
                if (isVertical) {
                    if (angleDeg != 90 && angleDeg != -90) {
                        box.style.writingMode = 'vertical-rl';
                        box.style.transformOrigin = 'center center';
                    } else {
                        box.style.transformOrigin = 'bottom left';
                        box.style.transform = (dy < 0) ? `rotate(${angleDeg}deg) scaleX(1)` : '';
                    }
                } else {
                    box.style.transform = `rotate(${angleDeg}deg)`;
                    box.style.transformOrigin = 'top left';
                }

                try {
                    OCRStrategy.adjustFontSize(box);
                } catch (e) {
                    console.error(e);
                }
            }

            requestAnimationFrame(updateChunk);
        }

        static updateOverlay(element, corsFreeCanvas = null, iElementData = null, isResize = false) {

            if (!element.ocrData) {
                return;
            }

            const container = element.parentElement;

            const { width: displayWidth, height: displayHeight, left: displayLeft, top: displayTop } = element.getBoundingClientRect();
            const canvasRect = element.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();

            const baseWidth = element.ocrBaseWidth || displayWidth;
            const baseHeight = element.ocrBaseHeight || displayHeight;

            let pdfZoomFactor = 0;
            const pdfViewer = document.getElementById('pdf-viewer');
            if (pdfOCR && pdfViewer && pdfViewer.style.transform) {
                const match = pdfViewer.style.transform.match(/scale\(([\d.]+)\)/);
                if (match && match[1]) {
                    pdfZoomFactor = parseFloat(match[1]);
                }
            }

            let zoomFactor;
            if (pdfZoomFactor > 0) {
                zoomFactor = (canvasRect.width / baseWidth) / pdfZoomFactor;
            } else {
                zoomFactor = canvasRect.width / baseWidth;
            }

            const offsetX = canvasRect.left - containerRect.left;
            const offsetY = canvasRect.top - containerRect.top;

            let scaleX = displayWidth / baseWidth;
            let scaleY = displayHeight / baseHeight;

            let boxes = container._ocrBoxes || [];
            for (let i = boxes.length; i < element.ocrData.length; i++) {
                const boxDiv = document.createElement('div');
                boxDiv.className = 'ocr-box';
                boxDiv.dataset.index = i;
                //boxDiv.contentEditable = "true";
                container.appendChild(boxDiv);

                boxDiv._keydownHandler = function (e) {
                    if (e.key === 'Backspace' && boxDiv.innerText.trim() === '') {
                        e.preventDefault();
                        const idx = parseInt(boxDiv.dataset.index, 10);
                        boxDiv.remove();
                        if (element.ocrData && idx >= 0 && idx < element.ocrData.length) {
                            element.ocrData[idx] = null;
                        }
                        //updateOverlay(element);
                    }
                };
                boxDiv.addEventListener('keydown', boxDiv._keydownHandler);

                boxDiv._beforeinputHandler = function (e) {
                    if (e.inputType === 'deleteContentBackward' && boxDiv.innerText.trim() === '') {
                        e.preventDefault();
                        const idx = parseInt(boxDiv.dataset.index, 10);
                        boxDiv.remove();
                        if (element.ocrData && idx >= 0 && idx < element.ocrData.length) {
                            element.ocrData[idx] = null;
                        }
                        //updateOverlay(element);
                    }
                };
                boxDiv.addEventListener('beforeinput', boxDiv._beforeinputHandler);

                boxes.push(boxDiv);
            }
            // Se invece ci sono più box del necessario, rimuovi quelli in eccesso
            if (boxes.length > element.ocrData.length) {
                for (let i = element.ocrData.length; i < boxes.length; i++) {
                    boxes[i].remove();
                }
                boxes = boxes.slice(0, element.ocrData.length);
            }
            container._ocrBoxes = boxes;

            let lastTranslatedIndex = -1;
            if (iElementData >= 0) {
                lastTranslatedIndex = iElementData;
            }


            OCRStrategy.updateBoxesInChunks(element, boxes, offsetX, offsetY, zoomFactor, corsFreeCanvas, lastTranslatedIndex);

            OCRStrategy.enableDragResizeForBoxes(element, corsFreeCanvas);
        }

        static calculateBoxColor(data, img, corsFreeCanvas, bbox, box, currentIndex, force = false) {
            try {
                if (!data.color || force) {
                    const ctx = OCRStrategy.getCtxFromElement(img, corsFreeCanvas);
                    if (ctx) {
                        const patchX = Math.floor(bbox.x0);
                        const patchY = Math.floor(bbox.y0);
                        const patchWidth = Math.max(1, Math.floor(bbox.x1 - bbox.x0));
                        const patchHeight = Math.max(1, Math.floor(bbox.y1 - bbox.y0));
                        const avgColor = OCRStrategy.sampleMedianColor(ctx, patchX, patchY, patchWidth, patchHeight);
                        box.style.background = `rgba(${avgColor.r}, ${avgColor.g}, ${avgColor.b}, ${avgColor.a / 255})`;
                        //console.log("Sampled color:", avgColor, "for box", currentIndex);
                        // Calcola la luminosità per decidere il colore del testo
                        const brightness = (avgColor.r * 299 + avgColor.g * 587 + avgColor.b * 114) / 1000;
                        box.style.color = brightness < 128 ? "#fff" : "#000";
                        img.ocrData[currentIndex].color = avgColor;
                    }
                }
            } catch (error) {
                console.error("Error sampling pixel color:", error);
            }
        }

        static enableDragResizeForBoxes(img, canvas = null) {
            const container = img.parentElement;
            const boxes = container.querySelectorAll('.ocr-box');
            const baseWidth = img.ocrBaseWidth || img.naturalWidth || img.width;
            const containerRect = container.getBoundingClientRect();
            const imgRect = img.getBoundingClientRect();
            const offsetX = imgRect.left - containerRect.left;
            const offsetY = imgRect.top - containerRect.top;

            let pdfZoomFactor = 0;
            const pdfViewer = document.getElementById('pdf-viewer');
            if (pdfOCR && pdfViewer && pdfViewer.style.transform) {
                const match = pdfViewer.style.transform.match(/scale\(([\d.]+)\)/);
                if (match && match[1]) {
                    pdfZoomFactor = parseFloat(match[1]);
                }
            }

            let zoomFactor;
            if (pdfZoomFactor > 0) {
                zoomFactor = (imgRect.width / baseWidth) / pdfZoomFactor;
            } else {
                zoomFactor = imgRect.width / baseWidth;
            }

            boxes.forEach(box => {
                // Rimuovi eventuali handle già esistenti
                box.querySelectorAll('.resize-handle').forEach(handle => handle.remove());

                if (box._dragHandlers) {
                    document.removeEventListener('mousemove', box._dragHandlers.mousemove);
                    document.removeEventListener('touchmove', box._dragHandlers.touchmove);
                }

                // Crea handle per ogni lato: top, right, bottom, left
                const sides = ['top', 'right', 'bottom', 'left'];
                const handles = {};
                sides.forEach(side => {
                    const handle = document.createElement('div');
                    handle.className = 'resize-handle ' + side;
                    handle.style.position = 'absolute';
                    handle.style.background = 'transparent'; // nessun indicatore visibile
                    if (side === 'top' || side === 'bottom') {
                        handle.style.height = '8px';
                        handle.style.width = '100%';
                        handle.style.left = '0';
                        handle.style.cursor = 'ns-resize';
                        if (side === 'top') {
                            handle.style.top = '-4px';
                        } else {
                            handle.style.bottom = '-4px';
                        }
                    } else {
                        handle.style.width = '8px';
                        handle.style.height = '100%';
                        handle.style.top = '0';
                        handle.style.cursor = 'ew-resize';
                        if (side === 'left') {
                            handle.style.left = '-4px';
                        } else {
                            handle.style.right = '-4px';
                        }
                    }
                    box.appendChild(handle);
                    handles[side] = handle;
                });

                const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
                corners.forEach(corner => {
                    const handle = document.createElement('div');
                    handle.className = 'resize-handle ' + corner;
                    handle.style.position = 'absolute';
                    handle.style.background = 'transparent';  // Nessun indicatore visibile
                    handle.style.width = '12px';
                    handle.style.height = '12px';
                    // Posiziona il handle in modo centrato rispetto all'angolo
                    if (corner === 'top-left') {
                        handle.style.top = '-6px';
                        handle.style.left = '-6px';
                        handle.style.cursor = 'nwse-resize';
                    } else if (corner === 'top-right') {
                        handle.style.top = '-6px';
                        handle.style.right = '-6px';
                        handle.style.cursor = 'nesw-resize';
                    } else if (corner === 'bottom-right') {
                        handle.style.bottom = '-6px';
                        handle.style.right = '-6px';
                        handle.style.cursor = 'nwse-resize';
                    } else if (corner === 'bottom-left') {
                        handle.style.bottom = '-6px';
                        handle.style.left = '-6px';
                        handle.style.cursor = 'nesw-resize';
                    }
                    box.appendChild(handle);
                    handles[corner] = handle;
                });

                // --- Drag functionality ---
                let currentDraggingBox = null;
                let isDragging = false;
                let dragTimer = null;
                let dragStartTime = 0;
                let dragStartX, dragStartY, origX, origY;
                let updatePending = false;

                function preventDefault(e) {
                    e.preventDefault();
                }

                function disableScrollOnContainer() {
                    const pdfContainer = document.getElementById("pdf-container");
                    if (pdfContainer) {
                        pdfContainer.classList.add('dragging');
                        pdfContainer.addEventListener("touchmove", preventDefault, { passive: false });
                    }
                }

                function enableScrollOnContainer() {
                    const pdfContainer = document.getElementById("pdf-container");
                    if (pdfContainer) {
                        pdfContainer.classList.remove('dragging');
                        pdfContainer.removeEventListener("touchmove", preventDefault, { passive: false });
                    }
                }

                function onDragStart(e) {
                    // Se si tocca un handle, non avvia il drag
                    if (e.target.classList.contains('resize-handle')) return;
                    // Se il box è già in editing (ha focus), non attivare il drag
                    if (box.contains(document.activeElement) && document.activeElement.classList.contains('ocr-box-text')) {
                        return;
                    }
                    if (box.getElementsByClassName('ocr-box-text').length > 0) {
                        const textElement = box.getElementsByClassName('ocr-box-text')[0];
                        if (textElement) {
                            textElement.contentEditable = "false";
                        }
                    }

                    dragStartTime = Date.now();
                    currentDraggingBox = this;
                    dragTimer = setTimeout(() => {
                        isDragging = true;
                        updatePending = true;
                        // Solo adesso il cursore diventa "move"
                        box.style.cursor = 'move';
                        box.classList.add('dragging');
                        disableScrollOnContainer();

                        dragStartX = e.touches ? e.touches[0].clientX : e.clientX;
                        dragStartY = e.touches ? e.touches[0].clientY : e.clientY;
                        origX = parseFloat(getComputedStyle(box).left) || 0;
                        origY = parseFloat(getComputedStyle(box).top) || 0;
                        e.preventDefault();
                    }, 300);
                }

                function onDragEnd(e) {
                    if (dragTimer) {
                        clearTimeout(dragTimer);
                        dragTimer = null;
                        // Se non è stato attivato il drag, interpretiamo il tocco breve come richiesta di editing
                        currentDraggingBox && currentDraggingBox.focus();
                        const textElement = currentDraggingBox ? currentDraggingBox.getElementsByClassName('ocr-box-text')[0] : null;
                        if (textElement) {
                            textElement.contentEditable = "true";
                            textElement.focus();
                        }
                    }
                    if (isDragging && currentDraggingBox) {
                        let box = currentDraggingBox;
                        box.style.cursor = 'default';
                        box.classList.remove('dragging');
                        enableScrollOnContainer();
                        isDragging = false;
                        if (updatePending) {
                            OCRStrategy.updateBoxOcrData(box, offsetX, offsetY, zoomFactor, img, canvas);
                            updatePending = false;
                        }
                        let textElement = box.getElementsByClassName('ocr-box-text')[0];
                        if (textElement) {
                            textElement.contentEditable = "true";
                            textElement.blur();
                        }
                        //Rimuovi focus dal box e dal testo
                        box.blur();
                        e.preventDefault();
                        e.stopPropagation();
                        currentDraggingBox = null;
                    } else {
                        // Se il tocco è stato breve, attiva l'edit mode
                        let box = currentDraggingBox;
                        if (box) {
                            box.focus();
                            if (box.getElementsByClassName('ocr-box-text').length > 0) {
                                let textElement = box.getElementsByClassName('ocr-box-text')[0];
                                if (textElement) {
                                    textElement.contentEditable = "true";
                                    textElement.focus();
                                }
                            }
                            box.style.cursor = 'text';
                            currentDraggingBox = null;
                        }
                    }
                }

                box.addEventListener('mousedown', onDragStart);
                box.addEventListener('touchstart', onDragStart);
                document.addEventListener('mouseup', onDragEnd);
                document.addEventListener('touchend', onDragEnd);


                function onDrag(e) {
                    if (!isDragging) return;
                    const currentX = e.touches ? e.touches[0].clientX : e.clientX;
                    const currentY = e.touches ? e.touches[0].clientY : e.clientY;
                    const diffX = currentX - dragStartX;
                    const diffY = currentY - dragStartY;
                    box.style.left = (origX + diffX) + 'px';
                    box.style.top = (origY + diffY) + 'px';
                    updatePending = true;
                    e.preventDefault();
                }

                box._dragHandlers = {
                    mousemove: onDrag,
                    touchmove: onDrag
                };

                document.addEventListener('mousemove', box._dragHandlers.mousemove);
                document.addEventListener('touchmove', box._dragHandlers.touchmove);

                // --- Resize functionality per ciascun lato ---
                function attachResizeListener(handle, resizeFn) {
                    let isResizing = false, resizeStartX, resizeStartY, origWidth, origHeight, origLeft, origTop;
                    let updateNeeded = false;

                    if (handle._resizeHandlers) {
                        document.removeEventListener('mousemove', handle._resizeHandlers.mousemove);
                        document.removeEventListener('touchmove', handle._resizeHandlers.touchmove);
                        document.removeEventListener('mouseup', handle._resizeHandlers.mouseup);
                        document.removeEventListener('touchend', handle._resizeHandlers.touchend);
                    }

                    function startResize(e) {
                        isResizing = true;
                        updateNeeded = false;
                        resizeStartX = e.touches ? e.touches[0].clientX : e.clientX;
                        resizeStartY = e.touches ? e.touches[0].clientY : e.clientY;
                        origWidth = parseFloat(getComputedStyle(box).width) || box.offsetWidth;
                        origHeight = parseFloat(getComputedStyle(box).height) || box.offsetHeight;
                        origLeft = parseFloat(getComputedStyle(box).left) || 0;
                        origTop = parseFloat(getComputedStyle(box).top) || 0;
                        e.stopPropagation();
                        e.preventDefault();
                    }
                    function onResize(e) {
                        if (!isResizing) return;
                        const currentX = e.touches ? e.touches[0].clientX : e.clientX;
                        const currentY = e.touches ? e.touches[0].clientY : e.clientY;
                        const diffX = currentX - resizeStartX;
                        const diffY = currentY - resizeStartY;
                        resizeFn(box, origWidth, origHeight, origLeft, origTop, diffX, diffY);
                        updateNeeded = true;
                        e.preventDefault();
                    }

                    function endResize(e) {
                        if (isResizing) {
                            isResizing = false;
                            if (updateNeeded) {
                                OCRStrategy.updateBoxOcrData(box, offsetX, offsetY, zoomFactor, img, canvas, true);
                                updateNeeded = false;
                            }
                        }
                    }

                    handle.addEventListener('mousedown', startResize);
                    handle.addEventListener('touchstart', startResize);

                    handle._resizeHandlers = {
                        mousemove: onResize,
                        touchmove: onResize,
                        mouseup: endResize,
                        touchend: endResize
                    };

                    document.addEventListener('mousemove', handle._resizeHandlers.mousemove);
                    document.addEventListener('touchmove', handle._resizeHandlers.touchmove);
                    document.addEventListener('mouseup', handle._resizeHandlers.mouseup);
                    document.addEventListener('touchend', handle._resizeHandlers.touchend);
                }

                attachResizeListener(handles['right'], function (box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.width = (origWidth + diffX) + 'px';
                    OCRStrategy.adjustFontSize(box);
                });
                // Left
                attachResizeListener(handles['left'], function (box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.width = (origWidth - diffX) + 'px';
                    box.style.left = (origLeft + diffX) + 'px';
                    OCRStrategy.adjustFontSize(box);
                });
                // Bottom
                attachResizeListener(handles['bottom'], function (box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.height = (origHeight + diffY) + 'px';
                    OCRStrategy.adjustFontSize(box);
                });
                // Top
                attachResizeListener(handles['top'], function (box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.height = (origHeight - diffY) + 'px';
                    box.style.top = (origTop + diffY) + 'px';
                    OCRStrategy.adjustFontSize(box);
                });

                // Resize per gli angoli
                // Top-left: ridimensiona in larghezza e altezza, aggiorna left e top
                attachResizeListener(handles['top-left'], function (box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.width = (origWidth - diffX) + 'px';
                    box.style.height = (origHeight - diffY) + 'px';
                    box.style.left = (origLeft + diffX) + 'px';
                    box.style.top = (origTop + diffY) + 'px';
                    OCRStrategy.adjustFontSize(box);
                });
                // Top-right: aumenta larghezza, diminuisce altezza, aggiorna top
                attachResizeListener(handles['top-right'], function (box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.width = (origWidth + diffX) + 'px';
                    box.style.height = (origHeight - diffY) + 'px';
                    box.style.top = (origTop + diffY) + 'px';
                    OCRStrategy.adjustFontSize(box);
                });
                // Bottom-right: aumenta larghezza e altezza
                attachResizeListener(handles['bottom-right'], function (box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.width = (origWidth + diffX) + 'px';
                    box.style.height = (origHeight + diffY) + 'px';
                    OCRStrategy.adjustFontSize(box);
                });
                // Bottom-left: diminuisce larghezza, aumenta altezza, aggiorna left
                attachResizeListener(handles['bottom-left'], function (box, origWidth, origHeight, origLeft, origTop, diffX, diffY) {
                    box.style.width = (origWidth - diffX) + 'px';
                    box.style.height = (origHeight + diffY) + 'px';
                    box.style.left = (origLeft + diffX) + 'px';
                    OCRStrategy.adjustFontSize(box);
                });
            });
        }

        static updateBoxOcrData(box, offsetX, offsetY, zoomFactor, img, canvas = null, color = false) {
            const computed = getComputedStyle(box);
            const newLeft = parseFloat(computed.left);
            const newTop = parseFloat(computed.top);
            const newWidth = parseFloat(computed.width);
            const newHeight = parseFloat(computed.height);
            // Converti le coordinate dallo spazio del container (con offset) nel sistema originale
            const newX0 = (newLeft - offsetX) / zoomFactor;
            const newY0 = (newTop - offsetY) / zoomFactor;
            const newX1 = ((newLeft - offsetX) + newWidth) / zoomFactor;
            const newY1 = ((newTop - offsetY) + newHeight) / zoomFactor;
            const index = parseInt(box.dataset.index, 10);
            if (img.ocrData && img.ocrData[index]) {
                img.ocrData[index].bbox = {
                    x0: newX0,
                    y0: newY0,
                    x1: newX1,
                    y1: newY1
                };
                //console.log("Aggiornato bbox per box", index, img.ocrData[index].bbox);
            }

            if (color) OCRStrategy.calculateBoxColor(img.ocrData[index], img, canvas, img.ocrData[index].bbox, box, index, color);

        }

        /**
         * Raggruppa i box OCR in cluster (paragrafi) sfruttando un algoritmo ispirato a DBSCAN.
         * La rappresentazione di ciascun box include:
         *  - xCenter, yCenter: il centro del box (calcolato dalla bbox)
         *  - width, height: le dimensioni del box
         *  - angle: l'angolo (in gradi) derivato dalla baseline
         *
         * L'algoritmo normalizza le distanze orizzontali e verticali in base alle dimensioni medie
         * dei box e include anche la differenza di angolo.
         *
         * @param {Array} ocrData - Array di oggetti con proprietà bbox, baseline e text
         * @param {number} eps - Soglia di vicinanza
         * @param {number} minPts - Numero minimo di punti per formare un cluster (default 2)
         * @returns {Array} - Array di gruppi, ciascuno con bbox aggregata, baseline e testo aggregato
         */
        static groupOcrData(ocrData, eps = 20, minPts = 2) {
            if (!ocrData || !Array.isArray(ocrData) || ocrData.length === 0) {
                return [];
            }

            // Funzione per calcolare le feature di un box
            function computeBoxFeatures(item) {
                const { x0, y0, x1, y1 } = item.bbox;
                const xCenter = (x0 + x1) / 2;
                const yCenter = (y0 + y1) / 2;
                const width = x1 - x0;
                const height = y1 - y0;
                let angle = 0;
                if (
                    item.baseline &&
                    item.baseline.x0 !== undefined &&
                    item.baseline.y0 !== undefined &&
                    item.baseline.x1 !== undefined &&
                    item.baseline.y1 !== undefined
                ) {
                    angle = Math.atan2(item.baseline.y1 - item.baseline.y0, item.baseline.x1 - item.baseline.x0) * (180 / Math.PI);
                }
                return { xCenter, yCenter, width, height, angle };
            }

            // Costruiamo un array di box con le relative feature
            const boxes = ocrData.map(item => ({
                item,
                features: computeBoxFeatures(item)
            }));

            // Calcola le dimensioni medie per normalizzare le distanze
            let totalWidth = 0, totalHeight = 0;
            boxes.forEach(b => {
                totalWidth += b.features.width;
                totalHeight += b.features.height;
            });

            /*     
            const avgWidth = totalWidth / boxes.length;
            const avgHeight = totalHeight / boxes.length;  
            const sigmaX = avgWidth;
            const sigmaY = avgHeight;
            const weightGap = gapWeight; // Regola questo valore per dare più o meno importanza al gap
            const weightContainment = containmentWeight; // Regola questo valore per dare più o meno importanza al contenimento
    
            function area(bbox) {
                return Math.max(0, bbox.x1 - bbox.x0) * Math.max(0, bbox.y1 - bbox.y0);
            }
            function intersectionArea(bboxA, bboxB) {
                const x0 = Math.max(bboxA.x0, bboxB.x0);
                const y0 = Math.max(bboxA.y0, bboxB.y0);
                const x1 = Math.min(bboxA.x1, bboxB.x1);
                const y1 = Math.min(bboxA.y1, bboxB.y1);
                return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
            }*/

            //TODO RENDERLO PIU ROBUSTO ANDANDO A PRENDERE DEI PUNTI DI FRONTIERA E PRENDERA LA MINIMA DISTANZA TTRA
            // I PUNTI DI FRONTIERA DEI DUE BOX, cosi sto includendo tutti i concetti voluti (gap or|ver , overlapping delle aree ecc.....)
            // HINT: Al posto di prendere 8 punti di frontiera consideriamo solo i punti di frontiera che si affacciano al box da confrontare
            //(es. se il box1 è a sinistra del box2 prendo solo i punti di frontiera a sinistra del box2 e viceversa)
            // Funzione che ritorna i punti di frontiera dati gli spigoli e i centri dei lati di una bbox
            function frontierPoints(bbox, direction) {
                const { x0, y0, x1, y1 } = bbox;
                switch (direction) {
                    case 'right':
                        return [
                            { x: x1, y: y0 },              // top-right
                            { x: x1, y: (y0 + y1) / 2 },     // right-center
                            { x: x1, y: y1 }                // bottom-right
                        ];
                    case 'left':
                        return [
                            { x: x0, y: y0 },              // top-left
                            { x: x0, y: (y0 + y1) / 2 },     // left-center
                            { x: x0, y: y1 }                // bottom-left
                        ];
                    case 'top':
                        return [
                            { x: x0, y: y0 },              // top-left
                            { x: (x0 + x1) / 2, y: y0 },     // top-center
                            { x: x1, y: y0 }                // top-right
                        ];
                    case 'bottom':
                        return [
                            { x: x0, y: y1 },              // bottom-left
                            { x: (x0 + x1) / 2, y: y1 },     // bottom-center
                            { x: x1, y: y1 }                // bottom-right
                        ];
                    default:
                        // Fallback: tutti i punti di frontiera
                        return [
                            { x: x0, y: y0 },
                            { x: x1, y: y0 },
                            { x: x1, y: y1 },
                            { x: x0, y: y1 },
                            { x: (x0 + x1) / 2, y: y0 },
                            { x: x1, y: (y0 + y1) / 2 },
                            { x: (x0 + x1) / 2, y: y1 },
                            { x: x0, y: (y0 + y1) / 2 }
                        ];
                }
            }

            // Nuova funzione di distanza:
            // Per due box b1 e b2, estraiamo i punti di frontiera e calcoliamo tutte le distanze Euclidee, restituendo il minimo.
            function boxDistance(b1, b2) {
                const bbox1 = b1.item.bbox;
                const bbox2 = b2.item.bbox;

                const points1 = frontierPoints(bbox1);
                const points2 = frontierPoints(bbox2);

                let minDistance = Infinity;
                for (let i = 0; i < points1.length; i++) {
                    for (let j = 0; j < points2.length; j++) {
                        const dx = points1[i].x - points2[j].x;
                        const dy = points1[i].y - points2[j].y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < minDistance) {
                            minDistance = dist;
                        }
                    }
                }

                const angle1 = b1.features.angle;
                const angle2 = b2.features.angle;
                let angleDiff = Math.abs(angle1 - angle2);
                if (angleDiff > 90) {
                    angleDiff = 180 - angleDiff;
                }

                return minDistance + angleDiff;
            }

            /*
            function boxDistanceV2(b1, b2) {
                const f1 = b1.features, f2 = b2.features;
                const bbox1 = b1.item.bbox, bbox2 = b2.item.bbox;
    
                // Calcola il gap orizzontale tra gli estremi adiacenti
                let hgap = 0;
                let vgap = 0;
    
                // Calcola gap orizzontale
                if (bbox1.x1 < bbox2.x0) {
                    hgap = bbox2.x0 - bbox1.x1;
                } else if (bbox2.x1 < bbox1.x0) {
                    hgap = bbox1.x0 - bbox2.x1;
                } else {
                    hgap = 0; // I box si sovrappongono orizzontalmente
                }
    
                // Calcola gap verticale
                if (bbox1.y1 < bbox2.y0) {
                    vgap = bbox2.y0 - bbox1.y1;
                } else if (bbox2.y1 < bbox1.y0) {
                    vgap = bbox1.y0 - bbox2.y1;
                } else {
                    vgap = 0; // I box si sovrappongono verticalmente
                }
    
    
                // Calcola la differenza tra i centri, normalizzando per le dimensioni medie
                const dx = (f1.xCenter - f2.xCenter) / sigmaX;
                const dy = (f1.yCenter - f2.yCenter) / sigmaY;
                const dEuclid = Math.sqrt(dx * dx + dy * dy);
    
                // Calcola la differenza d'angolo normalizzata
                const dAngle = Math.abs(f1.angle - f2.angle) / sigmaAngle;
                const area1 = area(bbox1);
                const area2 = area(bbox2);
                const interArea = intersectionArea(bbox1, bbox2);
                const minArea = Math.min(area1, area2);
                let overlapRatio = 0;
                if (minArea > 0) {
                    overlapRatio = Math.max(0, interArea / minArea);
                    // Se un box è completamente contenuto nell'altro, overlapRatio sarà 1
                }
                const containmentAdjustment = weightContainment * overlapRatio;
    
                // Combina tutti i termini: la distanza euclidea, il gap (con peso) e la differenza d'angolo
                const res = dEuclid + weightGap * (hgap + vgap) + dAngle - containmentAdjustment;
                return res;
            }*/

            // Implementazione semplificata di DBSCAN
            const clusters = [];
            const visited = new Array(boxes.length).fill(false);
            const assigned = new Array(boxes.length).fill(false);
            const noise = [];

            function regionQuery(idx) {
                const neighbors = [];
                for (let j = 0; j < boxes.length; j++) {
                    if (j === idx) continue;
                    if (boxDistance(boxes[idx], boxes[j]) <= eps) {
                        neighbors.push(j);
                    }
                }
                return neighbors;
            }

            function expandCluster(idx, neighbors, cluster) {
                cluster.push(idx);
                assigned[idx] = true;
                // Utilizziamo una coda per iterare sui vicini
                let queue = [...neighbors];
                while (queue.length > 0) {
                    const current = queue.shift();
                    if (!visited[current]) {
                        visited[current] = true;
                        const currentNeighbors = regionQuery(current);
                        if (currentNeighbors.length >= minPts) {
                            queue = queue.concat(currentNeighbors);
                        }
                    }
                    if (!assigned[current]) {
                        cluster.push(current);
                        assigned[current] = true;
                    }
                }
            }

            for (let i = 0; i < boxes.length; i++) {
                if (visited[i]) continue;
                visited[i] = true;
                const neighbors = regionQuery(i);
                if (neighbors.length < minPts) {
                    noise.push(i);
                } else {
                    const cluster = [];
                    expandCluster(i, neighbors, cluster);
                    clusters.push(cluster);
                }
            }

            // Filtra i punti etichettati come rumore che non sono già stati assegnati a un cluster
            const noiseFiltered = noise.filter(i => !assigned[i]);
            noiseFiltered.forEach(i => {
                clusters.push([i]);
            });

            // Funzione di utilità per calcolare la mediana
            function median(arr) {
                const sorted = arr.slice().sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
            }

            // Aggrega i dati per ciascun cluster per formare un gruppo (paragrafo)
            const groups = clusters.map(clusterIndices => {
                const clusterItems = clusterIndices.map(i => boxes[i].item);
                // Ordina in ordine di lettura: prima per y0, poi per x0
                clusterItems.sort((a, b) => {
                    if (a.bbox.y0 !== b.bbox.y0) return a.bbox.y0 - b.bbox.y0;
                    return a.bbox.x0 - b.bbox.x0;
                });
                const x0 = Math.min(...clusterItems.map(item => item.bbox.x0));
                const y0 = Math.min(...clusterItems.map(item => item.bbox.y0));
                const x1 = Math.max(...clusterItems.map(item => item.bbox.x1));
                const y1 = Math.max(...clusterItems.map(item => item.bbox.y1));
                const aggregatedText = clusterItems.map(item => item.text).join(" ");
                // Calcola il baseline mediano
                const baselines = clusterItems.map(item => item.baseline).filter(b => b);
                const baseline = {
                    x0: median(baselines.map(b => b.x0)),
                    y0: median(baselines.map(b => b.y0)),
                    x1: median(baselines.map(b => b.x1)),
                    y1: median(baselines.map(b => b.y1))
                };
                return {
                    bbox: { x0, y0, x1, y1 },
                    baseline,
                    originalText: aggregatedText,
                    translatedText: ""
                };
            });

            console.log("Gruppi trovati:", groups.length);
            return groups;
        }

        static debounce(func, wait) {
            let timeout;
            return function (...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
            };
        }


        scheduleOverlayUpdate(element, tempCanvas = null, iElementData = null) {
            if (!this._overlayUpdateScheduled) {
                this._overlayUpdateScheduled = true;
                requestAnimationFrame(() => {
                    this.debouncedUpdate(element, tempCanvas, iElementData);
                });
            }
        }

        static getResultLines(result) {
            if (!result || !result.data || !result.data.blocks) {
                result.data = { lines: [] };
                console.warn("No data found in OCR result, skipping...");
                return result;
            }
            const lines = result.data.blocks.map((block) => block.paragraphs.map((paragraph) => paragraph.lines)).flat(2);
            result.data.lines = lines;
            return result;
        }

        async _processOcrResult(element, container, tempCanvas, result, groupingThreshold = 20) {

            if (!result.data || !result.data.lines) {    // Necessary for new version of Tesseract.js (from 6.0)
                result = OCRStrategy.getResultLines(result);
            }

            let filteredLines = result.data.lines.filter(line => line.text.trim() !== "");

            if (filteredLines.length === 0) {
                console.warn("No text found in OCR result, skipping...");
                element.ocrData = [];
                element.dataset.ocrProcessed = "true";
                return;
            }

            // Rimuovi quei box che hanno nel testo solo simboli di qualsiasi tipo
            //filteredLines = filteredLines.filter(line => { return line.text.trim().match(/[a-zA-Z0-9]/); });

            const rawOcrData = filteredLines.map(line => ({
                bbox: line.bbox,
                baseline: line.baseline,
                translatedText: '',
                text: line.text.trim(),
            }));

            const blocks = OCRStrategy.groupOcrData(rawOcrData, groupingThreshold);
            // const blocks = groups.map(group => OCRStrategy.combineGroup(group));
            // const blocks = await processOcrWithDynamicWorker(rawOcrData);
            element.ocrData = blocks;
            element.ocrTranslator = this.translator;

            if (getComputedStyle(container).position === "static") {
                container.style.position = "relative";
            }

            ImmUtils.checkPaused();
            ImmUtils.yieldControl();

            this.scheduleOverlayUpdate(element, tempCanvas);

            const blockTexts = blocks.map(block => block.originalText.replace(/<br>/gi, '[[BR]]'));

            const translationPromises = blockTexts.map((text, i) => {
                return this.translator.translateText(text)
                    .then(translation => {
                        element.ocrData[i].translatedText = ImmUtils.decodeHTMLEntities(translation.trim()).replace(/\[\[BR\]\]/g, '<br>');
                        this.scheduleOverlayUpdate(element, tempCanvas, i);
                    })
                    .catch(e => {
                        console.error(`Errore nella traduzione del blocco ${i}:`, e);
                        element.ocrData[i].translatedText = '[[ERROR]]';
                        this.scheduleOverlayUpdate(element, tempCanvas);
                    });
            });
            await Promise.all(translationPromises);

            element.dataset.ocrProcessed = "true";

            return;
        }
    }

    class ImageOCRStrategy extends OCRStrategy {
        constructor(adapter, translator) {
            super(adapter, translator);
        }
        async process(img) {
            await ImmUtils.checkPaused();

            if (img.dataset.ocrProcessed === "true") {
                return;
            }

            if (!img.complete) {
                await new Promise(resolve => { img.onload = resolve; });
            }

            let imageForOCR = img;
            if (!img.crossOrigin || img.crossOrigin !== "anonymous") {
                try {
                    const response = await fetch(img.src);
                    const blob = await response.blob();
                    const dataUrl = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    imageForOCR = new Image();
                    imageForOCR.src = dataUrl;
                    await new Promise(resolve => { imageForOCR.onload = resolve; });
                } catch (error) {
                    console.error('Errore nel caricamento dell\'immagine tramite fetch:', error);
                }
            }

            let container = img.parentElement;
            if (!container.classList.contains('ocr-container')) {
                container = document.createElement('div');
                container.classList.add('ocr-container');
                container.style.position = 'relative';
                container.style.display = 'flex';
                img.parentElement.insertBefore(container, img);
                container.appendChild(img);
            }

            // Usa le dimensioni originali dell'immagine per l'OCR
            const originalWidth = imageForOCR.naturalWidth;
            const originalHeight = imageForOCR.naturalHeight;
            img.ocrBaseWidth = originalWidth;
            img.ocrBaseHeight = originalHeight;

            // Crea un canvas temporaneo e disegna l'immagine a dimensione originale
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = originalWidth;
            tempCanvas.height = originalHeight;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(imageForOCR, 0, 0, originalWidth, originalHeight);

            ImmUtils.observeCanvasResize(img);

            // Esegui l'OCR sul canvas
            const result = await this.adapter.recognize(tempCanvas, {});

            if (!result) throw new Error("Can't process Image OCR");

            return await this._processOcrResult(img, container, tempCanvas, result, 40);

        }
    }

    class PdfPageOCRStrategy extends OCRStrategy {
        constructor(adapter, translator) {
            super(adapter, translator);
        }

        /**
         * Mappa il risultato del testo estratto da PDF.js nello stesso formato
         * dei risultati dell'OCR (Tesseract.js) per poter riutilizzare _processOcrResult.
         * 
         * Assumiamo che ogni item di textPage.items abbia:
         *  - transform: [a, b, c, d, e, f] dove "e" e "f" sono le coordinate di traslazione;
         *  - width e height che indicano le dimensioni del testo;
         *  - str che è il testo estratto.
         *
         * Calcoliamo la bounding box come:
         *  - x0 = e,
         *  - y1 = f,
         *  - x1 = e + width,
         *  - y0 = f - height.
         */
        static mapPdfTextToOcrResult(textPage, viewport) {
            if (!textPage || !textPage.items) {
                throw new Error("Contenuto testo PDF non valido");
            }
            const lines = textPage.items
                .filter(item => item.str && item.str.trim() !== "")
                .map(item => {
                    // Combina la trasformazione del viewport con quella dell'item di testo
                    const t = pdfjsLib.Util.transform(viewport.transform, item.transform);
                    const x = t[4];
                    const y = t[5];
                    // Applichiamo lo scaling per larghezza e altezza
                    const width = item.width * viewport.scale;
                    const height = item.height * viewport.scale;

                    const bbox = {
                        x0: x,
                        y0: y - height,
                        x1: x + width,
                        y1: y
                    };

                    const baseline = {
                        x0: t[4],
                        y0: t[5],
                        x1: t[4] + t[0] * item.width,
                        y1: t[5] + t[1] * item.width
                    };
                    return {
                        // La bbox viene definita considerando che 'y' è la baseline
                        bbox: bbox,
                        //Rimuovo dal testo il carattere →
                        text: item.str.replace(/→/g, ''),
                        translatedText: "",
                        // La baseline è una linea orizzontale che parte da (x, y)
                        baseline: baseline,
                        has_baseline: true
                    };
                });
            console.log("Lines:", lines);
            return { data: { lines } };
        }

        async process(canvas) {
            await ImmUtils.checkPaused();

            if (canvas.dataset.ocrProcessed === "true") {
                return;
            }

            let container = canvas.parentElement;
            if (!container.classList.contains('ocr-container')) {
                container = document.createElement('div');
                container.classList.add('ocr-container');
                container.style.position = 'relative';
                container.style.display = 'inline-block';
                canvas.parentElement.insertBefore(container, canvas);
                container.appendChild(canvas);
            }

            const width = canvas.width;
            const height = canvas.height;
            canvas.ocrBaseWidth = width;
            canvas.ocrBaseHeight = height;

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = width;
            tempCanvas.height = height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(canvas, 0, 0, width, height);

            let result;
            //Controllo se il canvas ha textContent, se si non eseguo OCR ma mappo i dati textContent in ocrData
            if (canvas.pdfTextContent) {
                result = PdfPageOCRStrategy.mapPdfTextToOcrResult(canvas.pdfTextContent.text, canvas.pdfTextContent.viewport);
                if (!result) throw new Error("PDF Text mapping error");
            } else {
                result = await this.adapter.recognize(tempCanvas, {});
                if (!result) throw new Error("PDF OCR error");
            }

            return await this._processOcrResult(canvas, container, null, result, 18);
        }
    }

    // ================================
    // OCRManager
    // ================================
    class OCRManager {
        constructor(ocrWorker, translatorService, type) {
            this.ocrEngine = ocrWorker;
            this.translatorService = translatorService;
            this.ocrType = type;
        }

        /**
         * @returns {OCREngine} - L'oggetto OCREngine utilizzato per l'OCR.
         */
        getOcrEngine() {
            return this.ocrEngine;
        }

        setOcrEngine(ocrEngine) {
            this.ocrEngine = ocrEngine;
        }

        /**
         * @returns {BaseTranslator} - Il servizio di traduzione utilizzato per la traduzione.
         */
        getTranslatorService() {
            return this.translatorService;
        }

        setTranslatorService(translatorService) {
            this.translatorService = translatorService;
        }

        /**
         * Processa l'elemento usando la strategia OCR appropriata in base al tipo di contenuto.
         * @param {HTMLElement} element - L'elemento da processare (immagine o canvas per PDF).
         * @param {string} contentType - 'image' ot 'pdf'.
         * @returns nothing.
         */
        async processContent(element, contentType = null) {
            let type = contentType;
            if (!type) {
                type = this.ocrType;
            }

            let ocrStrategy;
            if (type === 'image' || type === 'page') {
                ocrStrategy = new ImageOCRStrategy(this.ocrEngine, this.translatorService);
            } else if (type === 'pdf') {
                ocrStrategy = new PdfPageOCRStrategy(this.ocrEngine, this.translatorService);
            } else {
                throw new Error(`OCR Type not supported: ${type}`);
            }
            return await ocrStrategy.process(element);
        }
    }

    class PageTranslationCore {
        constructor(translationService, uiManager, options) {
            this.uiManager = uiManager;
            this.translationService = translationService;
            this.total = 0;
            this.processed = 0;
            this.batchNodes = [];
            this.individualNodes = [];
            this.DELIMITER = options.delimiter || '[[BR]]';
            this.BATCH_MAX_LENGTH = options.batchMaxLength || 1000;
            this.NODE_DELIMITER = options.nodeDelimiter || '[[ND]]';
        }

        processPageState(body) {
            //Store original nodes
            ImmUtils.storeOriginalTextNodes();

            const textNodes = ImmUtils.getTextNodes(document.body);
            const total = textNodes.length;

            textNodes.forEach(node => {
                if (!node.parentElement || !node.parentElement.classList.contains('translation-wrapper')) {
                    if (node.parentNode) {
                        const wrapper = document.createElement('span');
                        wrapper.className = 'translation-wrapper';
                        node.parentNode.insertBefore(wrapper, node);
                        wrapper.appendChild(node);
                        // Aggiungiamo lo spinner solo se non è già presente
                        if (!wrapper.querySelector('.text-spinner')) {
                            let spinner = document.createElement('span');
                            spinner.className = 'text-spinner';

                            wrapper.appendChild(spinner);
                        }
                    }
                }
            });

            const batchNodes = [];
            const individualNodes = [];
            for (const node of textNodes) {
                if (node.nodeValue.length > this.BATCH_MAX_LENGTH) {
                    individualNodes.push(node);
                } else {
                    batchNodes.push(node);
                }
            }

            this.total = total;
            this.batchNodes = batchNodes;
            this.individualNodes = individualNodes;

            return total;
        }

        updateProgress() {
            this.processed += 1;
            this.uiManager.updateFeedback(`(${this.processed}/${this.total})`)
        }

        static removeSpinner(parent) {
            if (parent) {
                let spinner = parent.querySelector('.text-spinner');
                if (spinner) parent.removeChild(spinner);
            }
        }

        static addRetryButton(parent, node, retryCallback) {
            if (!parent) return;

            let retryBtn = document.createElement('button');
            retryBtn.className = 'text-retry-button';
            retryBtn.textContent = '↻';
            retryBtn.onclick = async function () {
                if (parent.contains(retryBtn)) parent.removeChild(retryBtn);

                let spinnerRetry = document.createElement('span');
                spinnerRetry.className = 'text-spinner';
                parent.appendChild(spinnerRetry);

                try {
                    const retryTranslated = await retryCallback(node.nodeValue);
                    node.nodeValue = retryTranslated;
                    if (parent.contains(spinnerRetry)) parent.removeChild(spinnerRetry);
                } catch (retryErr) {
                    if (parent.contains(spinnerRetry)) parent.removeChild(spinnerRetry);
                    console.error("Retry failed for node:", retryErr);
                    parent.appendChild(retryBtn);
                }
            };

            parent.appendChild(retryBtn);
        }

        static removeRetryButton(parent) {
            if (parent) {
                let retryBtn = parent.querySelector('.text-retry-button');
                if (retryBtn) parent.removeChild(retryBtn);
            }
        }

        async processPageNodes() {
            await Promise.all([
                this.processBatchNodes(),
                this.processIndividualNodes()
            ]);
            ImmUtils.storeOriginalTextNodes();
        }

        async processBatchNodes() {
            if (this.batchNodes.length > 0) {
                try {
                    await this.translateNodesBatch();
                } catch (error) {
                    console.error(`Errore nella traduzione dei nodi in batch - ${error.message}`);
                    await this.translateNodesIndividually();
                }
            }
        }

        async translateNodesIndividually() {
            for (const node of this.batchNodes) {
                await ImmUtils.checkPaused();
                let parent = node.parentElement;
                if (!parent) continue;
                try {
                    let result = await this.translationService.translateText(node.nodeValue);
                    node.nodeValue = result;
                    PageTranslationCore.removeSpinner(parent);
                } catch (err) {
                    PageTranslationCore.removeSpinner(parent);
                    PageTranslationCore.addRetryButton(parent,
                        node,
                        this.translationService?.translateText?.bind(this.translationService));
                    console.error(`Error translating node - ${err.message}`, "warning");
                }
                this.updateProgress();
            }
        }


        async translateNodesBatch() {
            // Raggruppa i nodi in batch in base al totale di caratteri
            let batches = [];
            let currentBatch = [];
            let currentLength = 0;
            for (const node of this.batchNodes) {
                const text = node.nodeValue;
                if (currentLength + text.length > this.BATCH_MAX_LENGTH && currentBatch.length > 0) {
                    batches.push([...currentBatch]);
                    currentBatch = [];
                    currentLength = 0;
                }
                currentBatch.push(node);
                currentLength += text.length;
            }
            if (currentBatch.length > 0) batches.push([...currentBatch]);

            for (const batch of batches) {
                await this.translateBatchRecursively(batch);
            }
        }

        async translateBatchRecursively(batch) {
            await ImmUtils.checkPaused();

            const combinedText = batch.map(node => node.nodeValue).join(this.NODE_DELIMITER);
            let translatedCombined;
            try {
                translatedCombined = await this.translationService.translateText(combinedText);
            } catch (e) {
                // Se il batch ha un solo nodo gestiamo spinner/retry
                if (batch.length === 1) {
                    let node = batch[0];
                    let parent = node.parentElement;
                    if (!parent) {
                        return;
                    }

                    try {
                        let result = await this.translationService.translateText(node.nodeValue);
                        node.nodeValue = result;
                        PageTranslationCore.removeSpinner(parent);
                        this.updateProgress();
                        return;
                    } catch (err) {
                        PageTranslationCore.removeSpinner(parent);
                        PageTranslationCore.addRetryButton(parent,
                            node,
                            this.translationService?.translateText?.bind(this.translationService));
                        console.error(`Errore nella traduzione del nodo - ${err.message}`);
                        return;
                    }
                }
                // Se il batch ha più nodi, suddividiamo ulteriormente
                const mid = Math.floor(batch.length / 2);
                await this.translateBatchRecursively(batch.slice(0, mid));
                await this.translateBatchRecursively(batch.slice(mid));
                return;
            }

            let translatedParts = translatedCombined.split(/(?:(?:\|[ \t\r\n]*){0,4}A[ \t\r\n]*I[ \t\r\n]*L[ \t\r\n]*E[ \t\r\n]*N[ \t\r\n]*S(?:[ \t\r\n]*\|){0,4}|(?:\|[ \t\r\n]*){1,3}d?(?:[ \t\r\n]*\|){1,3})/gi);

            if (translatedParts.length !== batch.length) {
                translatedParts = translatedParts.filter((part, index, arr) => {
                    if (index === 0) return true;
                    return ImmUtils.normalize(part) !== ImmUtils.normalize(arr[index - 1]);
                });
            }

            if (translatedParts.length !== batch.length) {
                if (batch.length === 1) {
                    let node = batch[0];
                    let parent = node.parentElement;
                    if (!parent) {
                        console.error("Il nodo non ha un elemento padre.");
                        return;
                    }
                    let spinner = parent.querySelector('.text-spinner');
                    try {
                        let result = await this.translationService?.translateText(node.nodeValue);
                        node.nodeValue = result;
                        PageTranslationCore.removeSpinner(parent);
                        this.updateProgress();
                        return;
                    } catch (err) {
                        PageTranslationCore.removeSpinner(parent);
                        PageTranslationCore.addRetryButton(parent,
                            node,
                            this.translationService?.translateText?.bind(this.translationService));
                        console.error(`Errore nella traduzione del nodo - ${err.message}`);
                        return;
                    }
                }

                const mid = Math.floor(batch.length / 2);
                await this.translateBatchRecursively(batch.slice(0, mid));
                await this.translateBatchRecursively(batch.slice(mid));
                return;
            }

            // Traduzione completata: per ogni nodo del batch, rimuoviamo spinner e retry (se presenti)
            for (let i = 0; i < batch.length; i++) {
                await ImmUtils.checkPaused();
                let parent = batch[i].parentElement;
                PageTranslationCore.removeSpinner(parent);
                PageTranslationCore.removeRetryButton(parent);
                batch[i].nodeValue = ImmUtils.decodeHTMLEntities(translatedParts[i]);
                this.updateProgress();
            }
        }

        async processIndividualNodes() {
            for (const node of this.individualNodes) {
                await ImmUtils.checkPaused();
                await this.translateSingleNode(node);
            }
        }

        async translateSingleNode(node) {
            let parent = node.parentElement;
            try {
                console.log("Translating individual node:", node.nodeValue);
                const translated = await this.translationService?.translateText(node.nodeValue);
                node.nodeValue = translated;
                this.updateProgress();
                PageTranslationCore.removeSpinner(parent);
            } catch (e) {
                PageTranslationCore.removeSpinner(parent);
                PageTranslationCore.addRetryButton(parent,
                    node,
                    this.translationService?.translateText?.bind(this.translationService));
                console.error("Error translating individual node:", e);
            }
        }

    }

    // ================================
    // Main App
    // ================================
    class TranslatorApp {
        constructor(options) {
            // options: { translatorOptions, queueDelay, ocrWorker, uiType }
            // uiType può essere 'pdf' o 'image'
            this.uiManager = UIManagerFactory.createUIManager(options.uiType);

            this.translationService = new TranslationService(
                options.translatorOptions,
                options.translator,
                options.queueDelay,
                options?.worker
            );

            this.translationService.initWorker();

            this.core = new PageTranslationCore(this.translationService, this.uiManager, options.coreSettings);

            this.ocrManager = new OCRManager(options.ocrWorker, this.translationService, options.uiType);
        }

        async translatePage() {
            try {
                this.uiManager.initUI();

                const total = this.core.processPageState(document.body);
                this.uiManager.updateFeedback(`(0/${total})`, true);

                await this.core.processPageNodes();

                //this.uiManager.updateFeedback("Completed! [Page]", false);
                //this.uiManager.removeUI(5000);
            } catch (e) {
                BaseUIManager.showNotification(`${e}`, "error");
            }
        }

        async translateImages() {
            try {
                this.uiManager.initUI();

                const images = document.querySelectorAll('img');
                const total = images.length;

                await this.ocrManager.getOcrEngine().initEngine();

                const promises = [];
                let processed = 0;
                images.forEach((img, index) => {
                    if (img.dataset.ocrProcessed === "true") return;
                    promises.push(
                        Promise.race([
                            (async () => {
                                return this.ocrManager.processContent(img)
                                    .then(() => {
                                        processed++;
                                        this.uiManager.updateFeedback(`Image (${processed}/${total})`);
                                    })
                                    .catch(async error => {
                                        await ImmUtils.checkPaused();
                                        console.error(`Error processing image ${index + 1}:`, error);
                                        return Promise.resolve();
                                    });
                            })(),
                            new Promise((_, reject) => {
                                const intervalId = setInterval(async () => {
                                    if (ImmUtils.isCancelled()) {
                                        clearInterval(intervalId);
                                        await this.ocrManager.getOcrEngine().terminateEngine();
                                        reject(new Error("Operation cancelled."));
                                    }
                                }, 50);
                            })
                        ])
                    );
                });

                await Promise.all(promises);
                await this.ocrManager.getOcrEngine().terminateEngine();

                //this.uiManager.updateFeedback("Completed! [Images]", false);
                //this.uiManager.removeUI(5000);

                console.log("Image translations completed");
                return 0;
            } catch (e) {
                BaseUIManager.showNotification(`${e}`, "error");
                return 1;
            }
        }

        async translateLocalImages() {
            try {
                this.uiManager.initUI();

                this.uiManager.updateFeedback(`(0/1)`, true);

                await this.translateImages();

                this.uiManager.updateFeedback(`Done (1/1)`, true);
                //this.uiManager.removeUI(500);
                console.log("Local image translations completed");
            } catch (e) {
                BaseUIManager.showNotification(`${e}`, "error");
            }
        }

        async translatePdf() {
            try {

                const module = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.0.375/+esm');
                window.pdfjsLib = module;

                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.0.375/pdf.worker.mjs';

                this.uiManager.initUI();

                const pdfData = atob(base64Data['data']);
                base64Data['data'] = "";

                const pdfContainer = document.getElementById("pdf-container");
                if (!pdfContainer) throw new Error("Elemento con id 'pdf-container' non trovato.");

                const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
                let totalPages = pdfDoc.numPages;
                this.uiManager.updateFeedback(`(0/${totalPages})`, true);

                //UiManager should be a PDFUiManager !
                let pageContainers = await this.uiManager.createPdfPages(pdfDoc);
                if (pageContainers.length !== totalPages) {
                    throw new Error("Errore nella creazione delle pagine PDF.");
                }

                let processed = 0;
                const concurrencyLimit = 1;
                let currentIndex = 0;

                await this.ocrManager.getOcrEngine().initEngine();

                const workerPool = async () => {
                    while (currentIndex < pageContainers.length) {
                        await ImmUtils.checkPaused();
                        const index = currentIndex++;
                        const canvas = pageContainers[index].querySelector("canvas");
                        try {
                            await this.ocrManager.processContent(canvas);
                            processed++;
                            this.uiManager.updateFeedback(`(${processed}/${totalPages})`);
                        } catch (error) {
                            console.error(`Error processing page ${index + 1}:`, error);
                            processed++;
                            this.uiManager.updateFeedback(`Error on page ${index + 1}`);
                        }
                    }
                };

                const poolTasks = [];
                for (let i = 0; i < concurrencyLimit; i++) {
                    poolTasks.push(workerPool());
                }
                await Promise.all(poolTasks);

                await this.ocrManager.getOcrEngine().terminateEngine();
                this.uiManager.updateFeedback("Done!", false);
                //this.uiManager.removeUI(5000);

                console.log("PDF translations completed");
            } catch (e) {
                BaseUIManager.showNotification(`${e}`, "error");
            }


        }

        async stop(delay = 0) {
            this.uiManager.removeUI(delay);
            this.translationService.stopWorker();
        }
    }

    async function getAzureAuthKey() {
        const url = "https://edge.microsoft.com/translate/auth";
        const options = {
            method: "GET",
        };

        try {
            const response = await fetch(url, options);

            if (!response.ok) {
                throw new Error("Couldn't get API key! Status: " + response.status);
            }

            return await response.text();
        } catch (err) {
            console.error("Errore nell'ottenere l'API key:", err);
            throw err;
        }
    }

    async function initConfig(option) {
        if (option.translator === "Microsoft" && option.translatorOptions.apiKey === "") {
            option.translatorOptions.apiKey = await getAzureAuthKey();
        }
        return option;
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

        setCoreSettings(delimiter = "||d||", batchMaxLength = 1000, nodeDelimiter = "|||AILENS|||") {
            this.options.coreSettings = { delimiter, batchMaxLength, nodeDelimiter };
            return this;
        }

        setTranslator(translator) {
            this.options.translator = translator;
            return this;
        }

        setTranslatorOptions(optionsObj) {
            this.options.translatorOptions = optionsObj;
            return this;
        }

        setQueueDelay(delay) {
            this.options.queueDelay = delay;
            return this;
        }

        setOCREngine(ocrLanguages, tessPsm = Tesseract.PSM.AUTO_OSD) {
            this.options.ocrEngine = new TesseractAdapter(ocrLanguages, {
                tessedit_pageseg_mode: tessPsm,
            });
            return this;
        }

        // Possiamo usare builderParam per eventuali personalizzazioni
        customize(builderParam) {
            // Ad esempio, se builderParam === "fast", potremmo abbreviare alcune impostazioni
            if (builderParam === "fast") {
                // Esempio: diminuisci il batchMaxLength e abbassa il delay
                this.options.coreSettings.batchMaxLength = 500;
                this.options.queueDelay = 500;
            }
            return this;
        }

        build() {
            return this.options;
        }
    }

    function addCSS() {
        const css = `
        @keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}@keyframes fadein{from{opacity:0!important;transform:translateY(-15px)}to{opacity:1!important;transform:translateY(0)}}@keyframes fadeout{from{opacity:1}to{opacity:0}}#translationContainer{position:fixed!important;bottom:20px!important;right:20px!important;display:flex!important;flex-direction:row!important;align-items:center!important;gap:8px!important;z-index:10000000!important;transition:transform .3s ease-in-out!important;transform-origin:right!important}#translationContainer.hidden{transform:translateX(68%)}#translationFeedbackBox{background:linear-gradient(135deg,rgba(44,62,80,.95),rgba(52,73,94,.85))!important;color:#fff!important;padding:16px 24px!important;border-radius:10px!important;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif!important;font-size:16px!important;display:flex!important;max-width:90vw!important;align-items:center!important;box-shadow:0 6px 16px rgba(0,0,0,.35)!important;backdrop-filter:blur(6px)!important;transition:transform .3s ease-in-out!important;transform-origin:right!important}.immTransl-arrow{width:24px;height:24px;cursor:pointer;transition:transform .3s ease;margin-right:12px;align-items:center;display:flex}#translationContainer.hidden .immTransl-arrow{transform:rotate(180deg)}#translationFeedbackBox .spinner{width:24px!important;height:24px!important;border:3px solid #fff!important;border-top:3px solid transparent!important;border-radius:50%!important;margin-right:12px!important;animation:spin 1s linear infinite}#notificationContainer{position:fixed!important;bottom:90px!important;right:20px!important;z-index:11000!important;display:flex!important;flex-direction:column!important;gap:10px!important;max-width:90vw!important}.notification{padding:12px 20px!important;border-radius:8px!important;color:#fff!important;font-family:Arial,sans-serif!important;font-size:16px!important;box-shadow:0 4px 12px rgba(0,0,0,.2)!important;animation:fadein .5s ease-out!important}.notification.error{background-color:#e74c3c!important}.notification.warning{background-color:#f1c40f!important;color:#000!important}.notification.success{background-color:#2ecc71!important;color:#000!important}.notification.info{background-color:#3498db!important;color:#fff!important}.fade-out{animation:fadeout .5s forwards!important}@media (max-width:600px){#translationFeedbackBox,.notification{font-size:14px!important;padding:10px 16px!important}#translationFeedbackBox .spinner{width:16px!important;height:16px!important;margin-right:8px!important}}#translationControls{margin-left:12px!important;display:flex!important;gap:8px!important}.immTransl-control-btn{width:36px!important;height:36px!important;border:none!important;border-radius:50%!important;cursor:pointer!important;outline:0!important;display:flex!important;align-items:center!important;justify-content:center!important;color:#fff!important;font-size:14px!important;transition:background-color .2s ease,transform .1s ease!important}.immTransl-control-btn:hover{filter:brightness(1.2)!important}.immTransl-control-btn:active{transform:scale(.95)!important}.immTransl-control-btn.pause{background-color:#f1c40f!important}.immTransl-control-btn.resume{background-color:#2ecc71!important}.immTransl-control-btn.cancel{background-color:#e74c3c!important}.immTransl-control-btn.reset{background:linear-gradient(135deg,rgba(44,62,80,.95),rgba(52,73,94,.85))!important;box-shadow:0 6px 16px rgba(0,0,0,.35)!important;backdrop-filter:blur(6px)!important;transition:background-color .3s ease,transform .1s ease!important;width:48px!important;height:48px!important}.immTransl-control-btn:disabled{opacity:.5!important;cursor:not-allowed!important}@media (max-width:600px){#translationFeedbackBox,.notification{font-size:14px!important;padding:10px 16px!important}#translationFeedbackBox .spinner{width:16px!important;height:16px!important;margin-right:8px!important}}.translation-wrapper{position:relative;align-items:center}.text-spinner{display:inline-block;width:1em;height:1em;border:3px solid rgba(0,0,0,.604);border-top:3px solid transparent;border-radius:50%;animation:spin 1s linear infinite;margin-left:5px;flex:0 0 auto}.text-retry-button{width:1em;height:1em;background-color:#e53935;color:#fff;border:none;border-radius:4px;padding:10px;display:inline-flex;align-items:center;justify-content:center;font-weight:500;text-transform:uppercase;cursor:pointer;outline:0;box-shadow:0 3px 1px -2px rgba(0,0,0,.2),0 2px 2px 0 rgba(0,0,0,.14),0 1px 5px 0 rgba(0,0,0,.12);transition:box-shadow .3s ease,background-color .3s ease;position:absolute;cursor:pointer;z-index:1000}.text-retry-button:hover{background-color:#d32f2f;box-shadow:0 5px 5px -3px rgba(0,0,0,.2),0 8px 10px 1px rgba(0,0,0,.14),0 3px 14px 2px rgba(0,0,0,.12)}.text-retry-button:active{background-color:#c62828;box-shadow:0 2px 4px -1px rgba(0,0,0,.2),0 4px 5px 0 rgba(0,0,0,.14),0 1px 10px 0 rgba(0,0,0,.12)}.text-retry-button::after{position:absolute;top:0;left:0;right:0;bottom:0;background:0 0;z-index:9999}.ocr-overlay{position:absolute!important;color:#fff!important;font-family:'Helvetica Neue',Arial,sans-serif!important;text-shadow:0 1px 2px rgba(0,0,0,.6)!important;padding:4px 8px!important;border-radius:0!important;display:flex;align-items:center!important;justify-content:center!important;z-index:9999!important;transition:opacity .3s ease!important;opacity:.95!important;overflow:hidden!important;white-space:pre-wrap!important}.ocr-box{position:absolute!important;background:linear-gradient(135deg,rgba(44,62,80,.95),rgba(52,73,94,.85));box-shadow:8px 8px 11px rgba(0,0,0,.1),0 1px 2px rgba(0,0,0,.1)!important;color:#fff;font-weight:400!important;display:flex;justify-content:center!important;align-items:center!important;flex-direction:column!important;-webkit-overflow-scrolling:touch;-webkit-backdrop-filter:blur(40px)!important;-webkit-hyphens:auto!important;line-height:1.2em!important;box-sizing:border-box!important;word-break:break-word!important;word-wrap:break-word!important;letter-spacing:normal!important;border-radius:8px!important;font-family:'Helvetica Neue',Arial,sans-serif!important;text-align:left!important;padding:2px 4px!important;overflow:auto!important;white-space:normal!important;z-index:9999!important}.ocr-box-text{font-size:100%}.ocr-box-text::-webkit-scrollbar{-webkit-appearance:none;width:0;height:0}.ocr-box::-webkit-scrollbar{-webkit-appearance:none;width:0;height:0}.ocr-box.dragging{touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}#pdf-container.dragging{touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none}.ocr-box.ocr-box-error{background:linear-gradient(135deg,#f8e1e1,#fdf5f5);color:#a94442;box-shadow:0 4px 8px rgba(0,0,0,.05);border-radius:8px;padding:0;overflow:hidden}.ocr-box.ocr-box-error:hover{transform:scale(1.02);box-shadow:0 8px 16px rgba(0,0,0,.2)}.ocr-box .spinner{display:inline-block;width:auto;height:1em;aspect-ratio:1;border:3px solid rgba(255,255,255,.1)!important;border-top:3px solid transparent!important;border-radius:50%!important;margin:auto!important;animation:spin 1s linear infinite}.ocr-box.ocr-box-error .ocr-retry-btn{display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#f44336;color:#fff;font-size:clamp(6px, 5vw, 24px);font-weight:500;border:none;outline:0;border-radius:4px;cursor:pointer;text-transform:uppercase;letter-spacing:.5px;position:relative;overflow:hidden;transition:background .3s,box-shadow .3s}.ocr-box.ocr-box-error .ocr-retry-btn:hover{background:#e53935;box-shadow:0 4px 8px rgba(0,0,0,.3)}.ocr-box.ocr-box-error .ocr-retry-btn:active{background:#d32f2f;box-shadow:0 2px 4px rgba(0,0,0,.2)}.ocr-box.ocr-box-error .ocr-retry-btn::after{content:"";position:absolute;top:50%;left:50%;width:5px;height:5px;background:rgba(255,255,255,.5);opacity:0;border-radius:50%;transform:translate(-50%,-50%) scale(1);transition:width .6s ease-out,height .6s ease-out,opacity .6s ease-out}.ocr-box.ocr-box-error .ocr-retry-btn:active::after{width:120%;height:120%;opacity:0;transition:0s}.img-container{position:relative!important;display:inline-block!important}#pdf-viewer{position:relative;width:auto;height:95%;display:flex}#pdf-toolbar{position:fixed;top:10px;left:50%;transform:translateX(-50%);width:90%;max-width:600px;height:55px;background:rgba(44,62,80,.7);backdrop-filter:blur(10px);border-radius:12px;color:#fff;display:flex;align-items:center;justify-content:space-between;z-index:1000000;box-shadow:0 4px 12px rgba(0,0,0,.2);padding:0 15px;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif}#pdf-toolbar button{background:rgba(255,255,255,.2);border:none;color:#fff;padding:10px;margin:0 5px;border-radius:8px;font-size:18px;cursor:pointer;transition:all .3s ease-in-out;display:flex;align-items:center;justify-content:center;width:42px;height:42px}#pdf-toolbar button:hover{background:rgba(255,255,255,.4)}#pdf-toolbar button:disabled{opacity:.5;cursor:not-allowed}#pdf-toolbar button i{font-size:22px}#pdf-toolbar span{font-size:18px;font-weight:700;text-align:center;flex-grow:1;padding:0 10px}.PDFtextLayer span{position:absolute!important}.PDFtextLayer{position:absolute;top:0;left:0;width:100%;height:100%}#pdf-container{margin-top:80px;flex:1;display:flex;flex-direction:column;gap:15px;overflow:visible;position:relative;margin:auto;width:95%}#pdf-container .ocr-container{position:relative;width:100%;box-shadow:0 0 6px rgba(0,0,0,.2);overflow:hidden}#pdf-container canvas{width:100%!important;height:auto!important;display:block}#pdfOptionsOverlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000;padding:20px;animation:fadeIn .3s ease-in-out}@keyframes fadeIn{from{opacity:0}to{opacity:1}}#pdfOptionsModal{background:#f5f5f5;border-radius:8px;padding:20px;width:100%;max-width:400px;box-shadow:0 4px 12px rgba(0,0,0,.15);font-family:Arial,sans-serif;opacity:0;transform:translateY(20px);animation:slideUp .4s forwards}@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}#pdfOptionsModal h2{margin-top:0;font-size:20px;color:#333;text-align:center;margin-bottom:20px}#pdfOptionsModal form>div{margin-bottom:15px}#pdfOptionsModal label{color:#333;font-size:14px;margin-left:8px}#pdfOptionsModal input[type=number],#pdfOptionsModal input[type=text]{width:calc(100% - 20px);padding:10px;margin-top:8px;border:1px solid #ccc;border-radius:4px;font-size:14px;transition:border-color .3s ease,box-shadow .3s ease}#pdfOptionsModal input[type=number]:focus,#pdfOptionsModal input[type=text]:focus{outline:0;border-color:#333;box-shadow:0 0 5px rgba(51,51,51,.3)}#pdfOptionsModal input[type=radio]{transform:scale(1.2);vertical-align:middle;margin-right:8px}#pdfOptionsModal .quality-container{display:flex;align-items:center;justify-content:center;gap:8px}#pdfOptionsModal .quality-container label{font-size:14px;color:#333}#pdfOptionsModal .quality-container input[type=range]{flex:1;margin:0}#pdfOptionsModal .quality-container span{width:40px;text-align:center;font-size:14px;color:#333}#pdfOptionsModal input[type=range]{-webkit-appearance:none;width:100%;height:6px;border-radius:3px;background:#ddd;outline:0;transition:background .3s}#pdfOptionsModal input[type=range]::-webkit-slider-runnable-track{width:100%;height:6px;cursor:pointer;background:#ddd;border-radius:3px}#pdfOptionsModal input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:#333;cursor:pointer;transition:background .3s,transform .2s;margin-top:-7px}#pdfOptionsModal input[type=range]::-webkit-slider-thumb:hover{background:#555;transform:scale(1.1)}@media (max-width:480px){#pdfOptionsModal .quality-container{flex-direction:column;align-items:center}#pdfOptionsModal .quality-container input[type=range]{width:100%;margin:8px 0}#pdfOptionsModal .quality-container span{text-align:center}}#pdfOptionsModal .button-group{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}#pdfOptionsModal button{padding:10px 18px;font-size:14px;border:none;border-radius:4px;cursor:pointer;transition:background-color .3s ease,transform .2s ease}#pdfOptionsModal button#cancelPdfOptions{background:#ccc;color:#fff}#pdfOptionsModal button#cancelPdfOptions:hover{background:#b3b3b3;transform:scale(1.02)}#pdfOptionsModal button#confirmPdfOptions{background:#333;color:#fff}#pdfOptionsModal button#confirmPdfOptions:hover{background:#1a1a1a;transform:scale(1.02)}@media (max-width:480px){#pdfOptionsModal{padding:15px;max-width:90%}#pdfOptionsModal h2{font-size:18px}#pdfOptionsModal button{padding:10px;font-size:16px}#pdfOptionsModal button#confirmPdfOptions{flex:auto}}@media (max-width:600px){#pdf-toolbar{width:95%;max-width:95%;height:60px;padding:0 10px}#pdf-toolbar button{width:44px;height:44px}#pdf-toolbar button i{font-size:20px}#pdf-toolbar span{font-size:16px}#pdf-viewer{margin-top:90px}#pdf-toolbar #pageIndicator,#pdf-toolbar #zoomIndicator{font-size:14px}}@media (max-width:480px){.ocr-box{padding:1px 2px!important;border-radius:4px!important}.ocr-overlay{padding:2px 4px!important}}
    `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    async function start(type = "page", downloadValue, pdfOCRValue, options = {}) {
        download = downloadValue;
        pdfOCR = pdfOCRValue;

        let o = new OptionsBuilder()
            .setCoreSettings()
            .setTranslator(options?.translator)
            .setTranslatorOptions(options?.translatorOptions)
            .setQueueDelay(options?.queueDelay)
            .setOCREngine(options?.ocrLanguages)
            .build();

        try {
            o = await initConfig(o);
        } catch (e) {
            console.error("Error initializing config:", e);
            return;
        }

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
                addCSS();
                await Promise.all([
                    app.translatePage(),
                    app.translateImages()]);
                app.uiManager.updateFeedback("Done!", false);
                app.stop(5000);
                break;
            case "image":
                await app.translateLocalImages();
                app.uiManager.updateFeedback("Done!", false);
                app.stop(5000);
                break;
            case "pdf":
                await app.translatePdf();
                app.stop(5000);
                break;
            default:
                throw new Error("Invalid type");
        }
    };

    const namespace = (typeof window !== "undefined") ? window : (typeof self !== "undefined") ? self : globalThis;
    namespace.immTrans = namespace.immTrans || {};
    namespace.immTrans.start = start;
})();
