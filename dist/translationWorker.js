// translationWorker.js
(function initWorker() {
    function workerCore() {

        let translatorInstance = null;

        const taskQueue = [];
        let head = 0;
        let processing = false;

        const DEBUG_ENABLED = false;
        const originalLog = console.log;
        function debug(...args) {
            if (DEBUG_ENABLED) {
                postMessage({ type: "debug", args });
                originalLog.apply(console, args);
            }
        }

        console.log = debug;

        async function processQueue(callDelay = 0) {
            if (processing) return;
            processing = true;
            while (head < taskQueue.length) {
                const { text, requestId } = taskQueue[head++];
                try {
                    debug("Processo traduzione per: ", text, requestId);
                    const translation = await translatorInstance.translate(text);
                    postMessage({ status: 'success', translation, requestId });
                } catch (err) {
                    debug("Errore durante la traduzione: ", err.message);
                    postMessage({ status: 'error', error: err.message, requestId });
                }
                if (callDelay > 0) {
                    await new Promise(resolve => setTimeout(resolve, callDelay));
                }
            }
            // Reset del buffer when empty
            taskQueue.length = 0;
            head = 0;
            processing = false;
        }

        // ================================
        // API Calls logic
        // ================================
        class FetchStrategy {
            async doFetch(url, options) {
                throw new Error("doFetch method not implemented");
            }
        }

        class DefaultFetchStrategy extends FetchStrategy {
            async doFetch(url, options) {
                return await fetch(url, options);
            }
        }

        class RetryFetchStrategy extends FetchStrategy {
            constructor(retries = 2, delay = 1000) {
                super();
                this.retries = retries;
                this.delay = delay;
            }

            async fetchWithRetry(url, options, retries = 2, delay = 1000) {
                try {
                    if (!navigator.onLine) {
                        const err = new Error("No internet connection");
                        err.status = 0;
                        err.statusText = "No internet connection";
                        throw err;
                    }

                    const response = await fetch(url, options);
                    if (!response.ok) {
                        const errorText = await response.text();
                        const error = new Error(`HTTP error! Status: ${response.status} || ${errorText}`);
                        error.status = response.status;
                        error.statusText = JSON.parse(errorText).error.message;
                        throw error;
                    }
                    return await response.json();
                } catch (err) {
                    if (retries > 0) {
                        console.error(`Fetch error: ${err.message}. Retrying in ${delay} ms...`);
                        await setTimeout(() => {}, delay);
                        return await this.fetchWithRetry(url, options, retries - 1, delay * 2);
                    } else {
                        console.error("Max retries reached.", err);
                        BaseUIManager.showNotification(`${err.statusText} (Error ${err.status})`, "error");
                        throw err;
                    }
                }
            }

            async doFetch(url, options) {
                return await this.fetchWithRetry(url, options, this.retries, this.delay);
            }
        }

        // ================================
        // Translators
        // ================================
        class BaseTranslator {
            constructor(apiKey, model, temperature, fetchClient = new RetryFetchStrategy(), targetLang = "EN", prompt = "Translate the following text: ", openAiUrl = "", callDelay = 0) {
                this.callDelay = callDelay;
                this.apiKey = apiKey;
                this.model = model;
                this.temperature = temperature;
                this.targetLang = targetLang;
                this.prompt = prompt;
                this.fetchClient = fetchClient;
                this.openAiUrl = openAiUrl;
                console.log("Translator initialized with:", this);
            }
            async translate(token) {
                throw new Error("Metodo 'translate' non implementato");
            }

            checkConfig() {
                if (this.apiKey.length < 1) {
                    throw new Error("Missing API Key");
                }
            }
        }

        class DeepLTranslator extends BaseTranslator {
            async translate(token) {
                super.checkConfig();

                const auth_key = this.apiKey;
                const url = "https://api-free.deepl.com/v2/translate";
                const data = new URLSearchParams();
                data.append("auth_key", auth_key);
                data.append("text", token);
                data.append("target_lang", this.targetLang);
                data.append("model_type", this.model);

                const options = {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: data.toString()
                };

                const responseData = await this.fetchClient.doFetch(url, options);
                if (responseData.translations && responseData.translations.length > 0) {
                    return responseData.translations[0].text;
                } else {
                    throw new Error("Nessuna traduzione ricevuta da DeepL");
                }
            }
        }

        class OpenAITranslator extends BaseTranslator {
            async translate(token) {
                super.checkConfig();
                const apiKey = this.apiKey;
                const url = `https://${this.openAiUrl}/chat/completions`;
                const data = {
                    model: this.model,
                    messages: [
                        {
                            role: "system",
                            content: "You are a translator.",
                        },
                        { role: "user", content: this.prompt + token }
                    ],
                    temperature: this.temperature,
                };

                const options = {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(data)
                };

                const responseData = await this.fetchClient.doFetch(url, options);
                if (responseData.choices && responseData.choices.length > 0) {
                    return responseData.choices[0].message.content.trim();
                } else {
                    throw new Error("No translation received from OpenAI.");
                }
            }
        }

        class GoogleTranslator extends BaseTranslator {
            async translate(token) {
                const apiKey = this.apiKey || "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520";
                const url = "https://translate-pa.googleapis.com/v1/translateHtml";

                const data = [
                    [
                        [token],
                        "auto",
                        this.targetLang,
                    ],
                    "wt_lib"
                ];

                const options = {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json+protobuf",
                        "X-Goog-API-Key": apiKey
                    },
                    body: JSON.stringify(data)
                };

                try {
                    const responseData = await this.fetchClient.doFetch(url, options);
                    if (Array.isArray(responseData) &&
                        responseData.length >= 1 &&
                        Array.isArray(responseData[0]) &&
                        responseData[0].length > 0) {
                        return responseData[0][0];
                    }
                } catch (err) {
                    throw err;
                }

                throw new Error("No traslation received from Google Translate.");

            }
        }

        class GeminiTranslator extends BaseTranslator {
            async translate(token) {
                super.checkConfig();
                const apiKey = this.apiKey;
                const model = this.model;
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                const data = {
                    contents: [
                        {
                            parts: [
                                {
                                    text: this.prompt + token,
                                }
                            ]
                        },
                    ]
                };

                const options = {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(data)
                };

                const responseData = await this.fetchClient.doFetch(url, options);
                if (responseData.candidates && responseData.candidates.length > 0) {
                    return responseData.candidates[0].content.parts[0].text.trim();
                }
                throw new Error("No translation received from Gemini AI.");

            }
        }

        class MicrosoftTranslator extends BaseTranslator {
            async translate(token) {
                super.checkConfig();
                const apiKey = this.apiKey;
                const url = `https://api-edge.cognitive.microsofttranslator.com/translate?&to=${this.targetLang}&api-version=3.0`;
                const data = [{ "Text": token }];

                const options = {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(data)
                };

                const responseData = await this.fetchClient.doFetch(url, options);
                if (responseData.length > 0 && responseData[0].translations) {
                    return responseData[0].translations[0].text.trim();
                } else {
                    throw new Error("No translation received from Microsoft.");
                }
            }
        }

        class TranslatorFactory {
            static createTranslator(config) {
                if (config.type) {
                    switch (config.type) {
                        case "DeepL":
                            return new DeepLTranslator(config.apiKey, config.model, config.temperature, new RetryFetchStrategy(),config.targetLang, config.prompt, "", config.callDelay);
                        case "ChatGPT":
                            return new OpenAITranslator(config.apiKey, config.model, config.temperature,new RetryFetchStrategy(), config.targetLang, config.prompt, config.openAiUrl, config.callDelay);
                        case "Mistral":
                            return new OpenAITranslator(config.apiKey, config.model, config.temperature,new RetryFetchStrategy(), config.targetLang, config.prompt, config.openAiUrl, config.callDelay);
                        case "Groq":
                            return new OpenAITranslator(config.apiKey, config.model, config.temperature,new RetryFetchStrategy(), config.targetLang, config.prompt, config.openAiUrl, config.callDelay);
                        case "Perplexity":
                            return new OpenAITranslator(config.apiKey, config.model, config.temperature,new RetryFetchStrategy(), config.targetLang, config.prompt, config.openAiUrl, config.callDelay);
                        case "Google":
                            return new GoogleTranslator(config.apiKey, config.model, config.temperature,new RetryFetchStrategy(), config.targetLang, config.prompt, "", config.callDelay);
                        case "Gemini":
                            return new GeminiTranslator(config.apiKey, config.model, config.temperature,new RetryFetchStrategy(), config.targetLang, config.prompt, "", config.callDelay);
                        case "Microsoft":
                            return new MicrosoftTranslator(config.apiKey, config.model, config.temperature,new RetryFetchStrategy(), config.targetLang, config.prompt, "", config.callDelay);
                        default:
                            throw new Error("Tipo di translator non valido");
                    }
                } else {
                    return new GoogleTranslator(config.apiKey, config.model, config.temperature,new RetryFetchStrategy(), config.targetLang, config.prompt, "", config.callDelay);
                }
            }
        }

        self.onmessage = async function (e) {
            const data = e.data;
            if (!data || !data.action) return;

            if (data.action === "init") {
                try {
                    debug("Inizializzazione del translator con", data.config);

                    translatorInstance = TranslatorFactory.createTranslator(data.config);
                    self.postMessage({ status: "initialized" });
                } catch (err) {
                    debug("Errore in init:", err.message);
                    self.postMessage({ status: "error", error: err.message });
                }
            } else if (data.action === "translateText") {
                const { text, requestId } = data;
                if (!translatorInstance) {
                    self.postMessage({ status: "error", error: "Translator non inizializzato", requestId });
                    return;
                }
                debug("Task aggiunto per:", text);
                // Enqueue del task e avvio del loop di process
                taskQueue.push({ text, requestId });
                processQueue(translatorInstance.callDelay);
            }
        };
    };

    // Fallback worker dybamic creation for JS Injection (bypassing CSP)
    const codeStr = workerCore.toString();
    const workerBody = codeStr.substring(codeStr.indexOf("{") + 1, codeStr.lastIndexOf("}"));
    const blob = new Blob([workerBody], { type: "text/javascript" });
    const blobUrl = URL.createObjectURL(blob);

    const namespace = (typeof window !== "undefined") ? window : (typeof self !== "undefined") ? self : globalThis;
    namespace.immTrans = namespace.immTrans || {};
    namespace.immTrans.worker = new Worker(blobUrl);
    namespace.immTrans.workerCore = workerCore;
})();