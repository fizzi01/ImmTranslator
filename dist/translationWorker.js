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
            constructor(retries = 2, delay = 5e3) {
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
                    if (retries > 0) return await setTimeout(() => {}, delay), await this.fetchWithRetry(url, options, retries - 1, 2 * delay);
                    throw err;
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
                this.openAiUrl = openAiUrl;
            }
            async translate(token) {
                throw new Error("Metodo 'translate' non implementato");
            }
            async translateBatch(batchPayload) {
                const results = [];
                for (const item of batchPayload.items) try {
                    const translated = await this.translate(item.content);
                    results.push({
                        id: item.id,
                        index: item.index,
                        originalText: item.content,
                        translatedText: translated,
                        success: !0
                    });
                } catch (error) {
                    results.push({
                        id: item.id,
                        index: item.index,
                        originalText: item.content,
                        translatedText: null,
                        success: !1,
                        error: error.message
                    });
                }
                return results;
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
            async translateBatch(batchPayload) {
                super.checkConfig();
                try {
                    const auth_key = this.apiKey, url = "https://api-free.deepl.com/v2/translate", data = new URLSearchParams;
                    data.append("auth_key", auth_key), data.append("target_lang", this.targetLang), 
                    data.append("model_type", this.model), batchPayload.items.forEach(item => {
                        data.append("text", item.content);
                    });
                    const options = {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded"
                        },
                        body: data.toString()
                    }, responseData = await this.fetchClient.doFetch(url, options);
                    if (responseData.translations && responseData.translations.length > 0) return batchPayload.items.map((item, index) => ({
                        id: item.id,
                        index: item.index,
                        originalText: item.content,
                        translatedText: responseData.translations[index]?.text || null,
                        success: !!responseData.translations[index]?.text,
                        error: responseData.translations[index]?.text ? null : "No translation received"
                    }));
                    throw new Error("Nessuna traduzione ricevuta da DeepL per il batch");
                } catch (error) {
                    return await super.translateBatch(batchPayload);
                }
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
            async translateBatch(batchPayload) {
                super.checkConfig();
                try {
                    const apiKey = this.apiKey, url = `https://${this.openAiUrl}/chat/completions`, numberedTexts = batchPayload.items.map((item, index) => `${index + 1}. ${item.content}`).join("\n"), data = {
                        model: this.model,
                        messages: [ {
                            role: "system",
                            content: "You are a translator. Translate each numbered item and respond with the same numbered format. Keep the exact numbering format."
                        }, {
                            role: "user",
                            content: `${this.prompt}\n\n${numberedTexts}`
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
                    if (responseData.choices && responseData.choices.length > 0) {
                        const translatedText = responseData.choices[0].message.content.trim(), results = (translatedText.split("\n"), 
                        []);
                        for (const item of batchPayload.items) {
                            const lineNumber = item.index + 1, regex = new RegExp(`^${lineNumber}\\.\\s*(.*)$`, "m"), match = translatedText.match(regex);
                            results.push({
                                id: item.id,
                                index: item.index,
                                originalText: item.content,
                                translatedText: match ? match[1].trim() : null,
                                success: !!match,
                                error: match ? null : "Could not parse numbered response"
                            });
                        }
                        return results;
                    }
                    throw new Error("No translation received from OpenAI.");
                } catch (error) {
                    return await super.translateBatch(batchPayload);
                }
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
            async translateBatch(batchPayload) {
                try {
                    const apiKey = this.apiKey || "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520", url = "https://translate-pa.googleapis.com/v1/translateHtml", data = [ [ batchPayload.items.map(item => item.content), "auto", this.targetLang ], "wt_lib" ], options = {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json+protobuf",
                            "X-Goog-API-Key": apiKey
                        },
                        body: JSON.stringify(data)
                    }, responseData = await this.fetchClient.doFetch(url, options);
                    if (Array.isArray(responseData) && responseData.length >= 1 && Array.isArray(responseData[0])) return batchPayload.items.map((item, index) => ({
                        id: item.id,
                        index: item.index,
                        originalText: item.content,
                        translatedText: responseData[0][index] || null,
                        success: !!responseData[0][index],
                        error: responseData[0][index] ? null : "No translation received"
                    }));
                    throw new Error("Invalid response format from Google Translate batch");
                } catch (error) {
                    return await super.translateBatch(batchPayload);
                }
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
            async translateBatch(batchPayload) {
                super.checkConfig();
                try {
                    const apiKey = this.apiKey, url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${apiKey}`, numberedTexts = batchPayload.items.map((item, index) => `${index + 1}. ${item.content}`).join("\n"), data = {
                        contents: [ {
                            parts: [ {
                                text: `${this.prompt}\n\nTranslate each numbered item and respond with the same numbered format:\n\n${numberedTexts}`
                            } ]
                        } ]
                    }, options = {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(data)
                    }, responseData = await this.fetchClient.doFetch(url, options);
                    if (responseData.candidates && responseData.candidates.length > 0) {
                        const translatedText = responseData.candidates[0].content.parts[0].text.trim(), results = [];
                        for (const item of batchPayload.items) {
                            const lineNumber = item.index + 1, regex = new RegExp(`^${lineNumber}\\.\\s*(.*)$`, "m"), match = translatedText.match(regex);
                            results.push({
                                id: item.id,
                                index: item.index,
                                originalText: item.content,
                                translatedText: match ? match[1].trim() : null,
                                success: !!match,
                                error: match ? null : "Could not parse numbered response"
                            });
                        }
                        return results;
                    }
                    throw new Error("No translation received from Gemini AI.");
                } catch (error) {
                    return await super.translateBatch(batchPayload);
                }
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
                }, responseData = await this.fetchClient.doFetch(url, options);
                if (responseData.length > 0 && responseData[0].translations) return responseData[0].translations[0].text.trim();
                throw new Error("No translation received from Microsoft.");
            }
            async translateBatch(batchPayload) {
                super.checkConfig();
                try {
                    const apiKey = this.apiKey, url = `https://api-edge.cognitive.microsofttranslator.com/translate?&to=${this.targetLang}&api-version=3.0`, data = batchPayload.items.map(item => ({
                        Text: item.content
                    })), options = {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${apiKey}`
                        },
                        body: JSON.stringify(data)
                    }, responseData = await this.fetchClient.doFetch(url, options);
                    if (Array.isArray(responseData) && responseData.length > 0) return batchPayload.items.map((item, index) => {
                        const response = responseData[index], translatedText = response?.translations?.[0]?.text;
                        return {
                            id: item.id,
                            index: item.index,
                            originalText: item.content,
                            translatedText: translatedText ? translatedText.trim() : null,
                            success: !!translatedText,
                            error: translatedText ? null : "No translation received"
                        };
                    });
                    throw new Error("Invalid response format from Microsoft Translator batch");
                } catch (error) {
                    return await super.translateBatch(batchPayload);
                }
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
                            callDelay > 0 && await new Promise(resolve => setTimeout(resolve, callDelay));
                        }
                        taskQueue.length = 0, head = 0, processing = !1;
                    }
                }(translatorInstance.callDelay);
            } else if ("translateBatch" === data.action) {
                const {batchPayload: batchPayload, requestId: requestId} = data;
                if (!translatorInstance) return void self.postMessage({
                    status: "error",
                    error: "Translator non inizializzato",
                    requestId: requestId
                });
                try {
                    debug(batchPayload.id, batchPayload.items.length);
                    const batchResults = await translatorInstance.translateBatch(batchPayload);
                    self.postMessage({
                        status: "success",
                        translation: batchResults,
                        requestId: requestId
                    });
                } catch (err) {
                    debug(err.message), self.postMessage({
                        status: "error",
                        error: err.message,
                        requestId: requestId
                    });
                }
            }
        }, self.postMessage({
            type: "ready"
        });
    }
    const codeStr = workerCore.toString(), workerBody = codeStr.substring(codeStr.indexOf("{") + 1, codeStr.lastIndexOf("}")),
    namespace = "undefined" != typeof window ? window : "undefined" != typeof self ? self : globalThis;
    namespace.immTrans = namespace.immTrans || {};
    namespace.immTrans.workerCore = workerCore;
    function createMainThreadShim() {
        // workerPort = "inside worker" (fakeSelf), callerPort = "outside" (returned to app)
        const channel = new MessageChannel();
        const workerPort = channel.port1, callerPort = channel.port2;
        const fakeSelf = {
            onmessage: null,
            postMessage: function(data) { workerPort.postMessage(data); },
            addEventListener: function() {},
            removeEventListener: function() {}
        };
        // Messages from caller -> workerPort -> fakeSelf.onmessage (workerCore handler)
        workerPort.onmessage = function(e) {
            if (typeof fakeSelf.onmessage === "function") fakeSelf.onmessage(e);
        };
        workerPort.start(); callerPort.start();
        try {
            const fn = new Function("self", "postMessage", workerBody);
            fn(fakeSelf, fakeSelf.postMessage);
        } catch(err) {}
        return {
            postMessage: function(data) { callerPort.postMessage(data); },
            addEventListener: function(type, fn) {
                if (type === "message") callerPort.addEventListener("message", fn);
            },
            removeEventListener: function(type, fn) {
                if (type === "message") callerPort.removeEventListener("message", fn);
            },
            terminate: function() { workerPort.close(); callerPort.close(); }
        };
    }
    // Try real Worker first; if CSP blocks it, fall back to main-thread shim
    namespace.immTrans.ready = new Promise(resolve => {
        let settled = false;
        function useShim() {
            console.warn("Skipping worker!");
            if (settled) return;
            settled = true;
            const shim = createMainThreadShim();
            namespace.immTrans.worker = shim;
            // Shim emits "ready" synchronously before listener, so use setTimeout
            shim.addEventListener("message", function handle(e) {
                if ("ready" === e.data?.type) { shim.removeEventListener("message", handle); resolve(); }
            });
            setTimeout(resolve, 100);
        }
        try {
            const blob = new Blob([ workerBody ], { type: "text/javascript" });
            const blobUrl = URL.createObjectURL(blob);
            // Listen for CSP violation before creating the Worker
            const onViolation = function(e) {
                if (e.violatedDirective && e.violatedDirective.startsWith("worker-src")) {
                    document.removeEventListener("securitypolicyviolation", onViolation);
                    useShim();
                }
            };
            document.addEventListener("securitypolicyviolation", onViolation);
            const realWorker = new Worker(blobUrl);
            // If Worker is created, wait for "ready" message with timeout
            const timeout = setTimeout(function() {
                // Timed out — Worker was created but never responded (CSP may have silently blocked)
                document.removeEventListener("securitypolicyviolation", onViolation);
                try { realWorker.terminate(); } catch(e) {}
                useShim();
            }, 2000);
            realWorker.addEventListener("message", function handle(e) {
                console.log("Using worker");
                if ("ready" === e.data?.type) {
                    clearTimeout(timeout);
                    document.removeEventListener("securitypolicyviolation", onViolation);
                    if (!settled) {
                        settled = true;
                        namespace.immTrans.worker = realWorker;
                        realWorker.removeEventListener("message", handle);
                        resolve();
                    }
                }
            });
            // Also handle Worker error event (some browsers fire this instead of CSP event)
            realWorker.addEventListener("error", function() {
                clearTimeout(timeout);
                document.removeEventListener("securitypolicyviolation", onViolation);
                try { realWorker.terminate(); } catch(e) {}
                useShim();
            });
        } catch(e) {
            useShim();
        }
    });
}();