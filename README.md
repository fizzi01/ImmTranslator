# Immersive Translator

**Immersive Translator** is a standalone JavaScript script designed for dynamic injection into web pages. It provides seamless inline translation for various content types:
- **Web Pages** (translating DOM text nodes and parsing images).
- **PDF Documents** (with text relocation and visual reconstruction).
- **Images**.

> [!NOTE]
> This script is specifically built for dynamic injection and internal integrations. It is not designed to be used or distributed as a general-purpose standalone library.

## Key Features
- **Context-Aware Page Translation**: Parses and translates HTML text nodes while preserving original styling and formatting.
- **Layout-Preserving PDF & Image Translation**: Retains the original text layout and document structure using XY-Cut++ algorithm. If a PDF lacks embedded text (or when processing standalone images), it seamlessly falls back to Tesseract.js for precise OCR extraction.
- **Multiple Translation Engines**: Out-of-the-box support for Google Translate, OpenAI, DeepL, Microsoft Translator, and Gemini.
- **Optimized Asynchronous Execution**: Utilizes Web Workers to offload API requests and keep the main thread responsive (includes an automatic main-thread fallback for strict CSP environments).
- **Advanced Customization**: Fine-grained control over system prompts, AI model temperatures, rate-limiting (queue delay), and target languages.

---

## API Usage

The script exposes a global interface accessible via `immTrans` or `window.ImmersiveTranslator`. The primary method to initiate translation is `immTrans.start()`.

### 1. Translating a Web Page

To initialize the translation for the current web page, specify the environment configuration and API options:

```javascript
immTrans.start("page", false, false, {
    ocrLanguages: ["eng", "spa", "fra", "jpn", "chi_sim"],
    translator: "OpenAI", // Can be "Google", "OpenAI", "DeepL", "Microsoft", "Gemini"
    translatorOptions: {
        apiKey: "YOUR_API_KEY_HERE",
        model: "gpt-4o-mini", // Model identifier
        temperature: 0,
        targetLang: "EN",
        prompt: "Some prompt for translation...",
        openAiUrl: "api.openai.com", // Custom proxy URL if needed
    },
    queueDelay: 150, // Delay in milliseconds between API calls to prevent rate-limiting
});
```

### 2. Translating a PDF Document

Initializing PDF translation follows a similar structure but requires the `"pdf"` type and explicit parameters to enable the download and OCR modules:

```javascript
immTrans.start("pdf", true, true, {
    ocrLanguages: ["eng", "spa", "fra", "jpn"],
    translator: "Google", 
    translatorOptions: {
        apiKey: "", // Using default/free tier if left empty
        model: "",
        temperature: 0,
        targetLang: "ES",
        prompt: "Some prompt for PDF translation...",
        openAiUrl: "",
    },
    queueDelay: 100,
});
```

---

## Integration Example: Standalone PDF Viewer

If you intend to use the script to render and translate a PDF within an isolated HTML environment or a static server environment, you can structure your document as follows. You will need to inject the Base64 data of the file and the core scripts at runtime.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
    <title>Immersive Translator - PDF Viewer</title>
    
    <!-- External Styles and Icons -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" crossorigin="anonymous">
    <link rel="stylesheet" href="main.css" crossorigin="anonymous">

    <!-- Dependencies (PDF parsing, DOM utilities) -->
    <script src="https://unpkg.com/jspdf@latest/dist/jspdf.umd.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@zumer/snapdom@2.5.0/dist/snapdom.min.js"></script>
    
    <!-- Immersive Translator Modules -->
    <script src="translationWorker.js"></script>
    <script src="OCR Engine script"></script>
    <script src="main.js"></script>

    <style>
        body {
            background-color: rgba(205, 205, 205, 0.53);
        }
    </style>
</head>
<body>
    <script>
        // 1. Inject serialized Base64 data
        const fileName = "Document_Name";
        const fileType = "pdf"; // Or "image"
        const base64Data = { data: "[Base64_String]..." }; 

        // 2. Automatically trigger the translation engine on load
        window.addEventListener("load", (event) => {
            immTrans.start("pdf", true, true, {
                ocrLanguages: ["eng", "spa", "fra", "jpn"],
                translator: "Google",
                translatorOptions: {
                    apiKey: "",
                    model: "",
                    temperature: 0,
                    targetLang: "EN",
                    prompt: "Act as a professional translator...",
                    openAiUrl: ""
                },
                queueDelay: 100
            });
        });
    </script>
</body>
</html>
```

## Real-World Use Case: Apple Shortcuts

A direct and powerful application of this script is its integration with Shortcuts. By leveraging Apple's native Shortcuts app, the script can be deeply integrated into the operating system ecosystem:
- **Safari Integration**: Run the translation script directly on any active web page seamlessly via the share sheet.
- **Document Automation**: Execute the script directly on local PDF documents or image files, automating the entire translation workflow natively.

You can find a live example of this implementation here: [Immersive Translator Shortcut](https://routinehub.co/shortcut/21559/)

## Architecture and Modules

The application manages various internal processes through a modular architecture, ensuring efficient handling of different content types and translation workflows:
1. **OCR & Layout Engine (`OCRStrategy`)**: Handles text recognition and positioning dynamically. It utilizes an algorithm based on XY-Cut++ to group bounding boxes and strictly preserve the exact layout of the original text. It intelligently distinguishes between PDFs containing native text and structural standalone images, applying Tesseract.js conditionally when embedded text is unavailable.
2. **Web Workers (`FetchStrategy`)**: API calls traversing to providers (OpenAI, Gemini, DeepL, etc.) are encapsulated and delegated to a hidden worker. A proxy shim strategy provides fallback mechanisms to bypass strict Cross-Origin Resource Sharing (CORS) exceptions or CSP worker restrictions.
3. **Queue Manager**: Accurately throttles API consumption by batching small text fragments into structured payloads, minimizing token usage and limiting network overload.
