(function() {
   let t =  document.createElement('script');
t.type = 'text/javascript';
t.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
t.onload = function () {
    let script = document.createElement('script'); 
    script.type = 'text/javascript'; 
script.src = "https://cdn.jsdelivr.net/gh/fizzi01/ImmTranslator/main.js";
    document.body.appendChild(script); 
    script.onload = function () {  };
};
document.body.appendChild(t);
})();
