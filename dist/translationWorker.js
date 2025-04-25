!function initWorker() {
    function workerCore() {
        let translatorInstance = null;
        const taskQueue = [];
        let head = 0, processing = !1;
        console.log;
        function debug(...args) {
            0;
        }
        console.log = debug;
        class FetchStrategy {
            async doFetch(url, options) {
                throw new Error("doFetch method not implemented");
            }
        }
        class RetryFetchStrategy extends FetchStrategy {
            constructor(retries = 2, delay = 1e3) {
                super(), this.retries = retries, this.delay = delay;
            }
            async fetchWithRetry(url, options, retries = 2, delay = 1e3) {
                try {
                    if (!navigator.onLine) {
                        const err = new Error("No internet connection");
                        throw err.status = 0, err.statusText = "No internet connection", err;
                    }
                    const response = await fetch(url, options);
                    if (!response.ok) {
                        const errorText = await response.text(), error = new Error(`HTTP error! Status: ${response.status} || ${errorText}`);
                        throw error.status = response.status, error.statusText = JSON.parse(errorText).error.message, 
                        error;
                    }
                    return await response.json();
                } catch (err) {
                    if (retries > 0) return console.error(`Fetch error: ${err.message}. Retrying in ${delay} ms...`), 
                    await setTimeout((() => {}), delay), await this.fetchWithRetry(url, options, retries - 1, 2 * delay);
                    throw console.error(`Fetch error: ${err.message}. No more retries left.`), err;
                }
            }
            async doFetch(url, options) {
                return await this.fetchWithRetry(url, options, this.retries, this.delay);
            }
        }
        class BaseTranslator {
            constructor(apiKey, model, temperature, fetchClient = new RetryFetchStrategy, targetLang = "EN", prompt = "Translate the following text: ", openAiUrl = "", callDelay = 0) {
                this.callDelay = callDelay, this.apiKey = apiKey, this.model = model, this.temperature = temperature, 
                this.targetLang = targetLang, this.prompt = prompt, this.fetchClient = fetchClient, 
                this.openAiUrl = openAiUrl, console.log("Translator initialized with:", this);
            }
            async translate(token) {
                throw new Error("Metodo 'translate' non implementato");
            }
            checkConfig() {
                if (this.apiKey.length < 1) throw new Error("Missing API Key");
            }
        }
        class DeepLTranslator extends BaseTranslator {
            async translate(token) {
                super.checkConfig();
                const auth_key = this.apiKey, data = new URLSearchParams;
                data.append("auth_key", auth_key), data.append("text", token), data.append("target_lang", this.targetLang), 
                data.append("model_type", this.model);
                const options = {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: data.toString()
                }, responseData = await this.fetchClient.doFetch("https://api-free.deepl.com/v2/translate", options);
                if (responseData.translations && responseData.translations.length > 0) return responseData.translations[0].text;
                throw new Error("Nessuna traduzione ricevuta da DeepL");
            }
        }
        class OpenAITranslator extends BaseTranslator {
            async translate(token) {
                super.checkConfig();
                const apiKey = this.apiKey, url = `https://${this.openAiUrl}/chat/completions`, data = {
                    model: this.model,
                    messages: [ {
                        role: "system",
                        content: "You are a translator."
                    }, {
                        role: "user",
                        content: this.prompt + token
                    } ],
                    temperature: this.temperature
                }, options = {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(data)
                }, responseData = await this.fetchClient.doFetch(url, options);
                if (responseData.choices && responseData.choices.length > 0) return responseData.choices[0].message.content.trim();
                throw new Error("No translation received from OpenAI.");
            }
        }
        class GoogleTranslator extends BaseTranslator {
            async translate(token) {
                const apiKey = this.apiKey || "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520", data = [ [ [ token ], "auto", this.targetLang ], "wt_lib" ], options = {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json+protobuf",
                        "X-Goog-API-Key": apiKey
                    },
                    body: JSON.stringify(data)
                };
                try {
                    const responseData = await this.fetchClient.doFetch("https://translate-pa.googleapis.com/v1/translateHtml", options);
                    if (Array.isArray(responseData) && responseData.length >= 1 && Array.isArray(responseData[0]) && responseData[0].length > 0) return responseData[0][0];
                } catch (err) {
                    throw err;
                }
                throw new Error("No traslation received from Google Translate.");
            }
        }
        class GeminiTranslator extends BaseTranslator {
            async translate(token) {
                super.checkConfig();
                const apiKey = this.apiKey, url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${apiKey}`, data = {
                    contents: [ {
                        parts: [ {
                            text: this.prompt + token
                        } ]
                    } ]
                }, options = {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(data)
                }, responseData = await this.fetchClient.doFetch(url, options);
                if (responseData.candidates && responseData.candidates.length > 0) return responseData.candidates[0].content.parts[0].text.trim();
                throw new Error("No translation received from Gemini AI.");
            }
        }
        class MicrosoftTranslator extends BaseTranslator {
            async translate(token) {
                super.checkConfig();
                const apiKey = this.apiKey, url = `https://api-edge.cognitive.microsofttranslator.com/translate?&to=${this.targetLang}&api-version=3.0`, data = [ {
                    Text: token
                } ], options = {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(data)
                };
                console.log("Microsoft Translator options: ", options);
                const responseData = await this.fetchClient.doFetch(url, options);
                if (responseData.length > 0 && responseData[0].translations) return responseData[0].translations[0].text.trim();
                throw new Error("No translation received from Microsoft.");
            }
        }
        class TranslatorFactory {
            static createTranslator(config) {
                if (!config.type) return new GoogleTranslator(config.apiKey, config.model, config.temperature, new RetryFetchStrategy, config.targetLang, config.prompt, "", config.callDelay);
                switch (config.type) {
                  case "DeepL":
                    return new DeepLTranslator(config.apiKey, config.model, config.temperature, new RetryFetchStrategy, config.targetLang, config.prompt, "", config.callDelay);

                  case "ChatGPT":
                    return new OpenAITranslator(config.apiKey, config.model, config.temperature, new RetryFetchStrategy, config.targetLang, config.prompt, config.openAiUrl, config.callDelay);

                  case "Mistral":
                    return new OpenAITranslator(config.apiKey, config.model, config.temperature, new RetryFetchStrategy, config.targetLang, config.prompt, config.openAiUrl, config.callDelay);

                  case "Groq":
                    return new OpenAITranslator(config.apiKey, config.model, config.temperature, new RetryFetchStrategy, config.targetLang, config.prompt, config.openAiUrl, config.callDelay);

                  case "Perplexity":
                    return new OpenAITranslator(config.apiKey, config.model, config.temperature, new RetryFetchStrategy, config.targetLang, config.prompt, config.openAiUrl, config.callDelay);

                  case "Google":
                    return new GoogleTranslator(config.apiKey, config.model, config.temperature, new RetryFetchStrategy, config.targetLang, config.prompt, "", config.callDelay);

                  case "Gemini":
                    return new GeminiTranslator(config.apiKey, config.model, config.temperature, new RetryFetchStrategy, config.targetLang, config.prompt, "", config.callDelay);

                  case "Microsoft":
                    return new MicrosoftTranslator(config.apiKey, config.model, config.temperature, new RetryFetchStrategy, config.targetLang, config.prompt, "", config.callDelay);

                  default:
                    throw new Error("Tipo di translator non valido");
                }
            }
        }
        self.onmessage = async function(e) {
            const data = e.data;
            if (data && data.action) if ("init" === data.action) try {
                debug(data.config), translatorInstance = TranslatorFactory.createTranslator(data.config), 
                self.postMessage({
                    status: "initialized"
                });
            } catch (err) {
                debug(err.message), self.postMessage({
                    status: "error",
                    error: err.message
                });
            } else if ("translateText" === data.action) {
                const {text: text, requestId: requestId} = data;
                if (!translatorInstance) return void self.postMessage({
                    status: "error",
                    error: "Translator non inizializzato",
                    requestId: requestId
                });
                debug(), taskQueue.push({
                    text: text,
                    requestId: requestId
                }), async function processQueue(callDelay = 0) {
                    if (!processing) {
                        for (processing = !0; head < taskQueue.length; ) {
                            const {text: text, requestId: requestId} = taskQueue[head++];
                            try {
                                debug();
                                const translation = await translatorInstance.translate(text);
                                postMessage({
                                    status: "success",
                                    translation: translation,
                                    requestId: requestId
                                });
                            } catch (err) {
                                debug(err.message), postMessage({
                                    status: "error",
                                    error: err.message,
                                    requestId: requestId
                                });
                            }
                            callDelay > 0 && await new Promise((resolve => setTimeout(resolve, callDelay)));
                        }
                        taskQueue.length = 0, head = 0, processing = !1;
                    }
                }(translatorInstance.callDelay);
            }
        }, self.postMessage({
            type: "ready"
        });
    }
    const codeStr = workerCore.toString(), workerBody = codeStr.substring(codeStr.indexOf("{") + 1, codeStr.lastIndexOf("}")), blob = new Blob([ workerBody ], {
        type: "text/javascript"
    }), blobUrl = URL.createObjectURL(blob), namespace = "undefined" != typeof window ? window : "undefined" != typeof self ? self : globalThis;
    namespace.immTrans = namespace.immTrans || {}, namespace.immTrans.worker = new Worker(blobUrl), 
    namespace.immTrans.workerCore = workerCore, namespace.immTrans.ready = new Promise((resolve => {
        namespace.immTrans.worker.addEventListener("message", (function handle(e) {
            "ready" === e.data?.type && (namespace.immTrans.worker.removeEventListener("message", handle), 
            resolve());
        }));
    }));
}();