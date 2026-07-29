// Gerador de PDF autocontido (sem dependencias, sem window.print, sem <a download>).
// Extraido de template.html — reaproveitavel para outras operadoras.
//
// Requisitos do contexto onde for colado:
//   - escapeHtml(s), fmtPhone(digits), showToast(msg)
//   - currentRecords(), matches(r), filterLabel(), DB, state, TIPO_LABEL
//   - vars PDF_SERENUS_JPG / PDF_SULA_JPG (JPEG base64) e as dimensoes _W/_H
//   - um botao #pdfbtn e o CSS de #pdfviewer
//
// Por que nao usa download direto: dentro de um iframe com sandbox (artifact) o
// Chrome bloqueia <a download> SEM lancar erro. A entrega vai por window.open e,
// se o popup for barrado, por um visualizador embutido na propria pagina.

  // ---------- Gerador de PDF nativo (sem dependencias, sem window.print) ----------
  var PDF_W = 595.28, PDF_H = 841.89, PDF_M = 42;
  var PDF_TIPO_LABEL = {ps:"Pronto Socorro", hm:"Hospital / Maternidade", hd:"Hospital Dia", mc:"Medico / Clinica"};

  // Helvetica (WinAnsi) nao tem os mesmos glifos que a tela; normaliza acentos
  // para o subconjunto seguro e escapa os caracteres especiais do PDF.
  function pdfStr(s){
    s = (s == null ? "" : String(s));
    var out = "";
    for(var i=0;i<s.length;i++){
      var code = s.charCodeAt(i);
      var ch = s[i];
      if(code > 255){ ch = "?"; }
      if(ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
      else out += ch;
    }
    return out;
  }

  // Larguras reais do Helvetica (unidades/1000) para as faixas ASCII + Latin-1 usadas.
  var HELV_W = {' ':278,'!':278,'"':355,'#':556,'$':556,'%':889,'&':667,"'":191,'(':333,')':333,'*':389,'+':584,',':278,'-':333,'.':278,'/':278,'0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,'8':556,'9':556,':':278,';':278,'<':584,'=':584,'>':584,'?':556,'@':1015,'A':667,'B':667,'C':722,'D':722,'E':667,'F':611,'G':778,'H':722,'I':278,'J':500,'K':667,'L':556,'M':833,'N':722,'O':778,'P':667,'Q':778,'R':722,'S':667,'T':611,'U':722,'V':667,'W':944,'X':667,'Y':667,'Z':611,'[':278,'\\':278,']':278,'^':469,'_':556,'`':333,'a':556,'b':556,'c':500,'d':556,'e':556,'f':278,'g':556,'h':556,'i':222,'j':222,'k':500,'l':222,'m':833,'n':556,'o':556,'p':556,'q':556,'r':333,'s':500,'t':278,'u':556,'v':500,'w':722,'x':500,'y':500,'z':500,'{':334,'|':260,'}':334,'~':584};
  var HELVB_W = {' ':278,'!':333,'"':474,'#':556,'$':556,'%':889,'&':722,"'":238,'(':333,')':333,'*':389,'+':584,',':278,'-':333,'.':278,'/':278,'0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,'8':556,'9':556,':':333,';':333,'<':584,'=':584,'>':584,'?':611,'@':975,'A':722,'B':722,'C':722,'D':722,'E':667,'F':611,'G':778,'H':722,'I':278,'J':556,'K':722,'L':611,'M':833,'N':722,'O':778,'P':667,'Q':778,'R':722,'S':667,'T':611,'U':722,'V':667,'W':944,'X':667,'Y':667,'Z':611,'[':333,'\\':278,']':333,'^':584,'_':556,'`':333,'a':556,'b':611,'c':556,'d':611,'e':556,'f':333,'g':611,'h':611,'i':278,'j':278,'k':556,'l':278,'m':889,'n':611,'o':611,'p':611,'q':611,'r':389,'s':556,'t':333,'u':611,'v':556,'w':778,'x':556,'y':556,'z':500,'{':389,'|':280,'}':389,'~':584};

  function pdfTextWidth(s, size, bold){
    var tbl = bold ? HELVB_W : HELV_W;
    var total = 0;
    s = (s == null ? "" : String(s));
    for(var i=0;i<s.length;i++){
      var w = tbl[s[i]];
      total += (w == null ? 556 : w);
    }
    return total * size / 1000;
  }

  function pdfWrap(s, maxW, size, bold){
    var words = String(s == null ? "" : s).split(" ");
    var lines = [], cur = "";
    for(var i=0;i<words.length;i++){
      var test = cur ? cur + " " + words[i] : words[i];
      if(pdfTextWidth(test, size, bold) > maxW && cur){
        lines.push(cur);
        cur = words[i];
      } else {
        cur = test;
      }
    }
    if(cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  function b64ToBinary(b64){
    return atob(b64);
  }

  function buildPdfBlob(records, meta){
    var objects = [];
    function newObj(dict, data){
      objects.push({dict: dict, data: data});
      return objects.length;
    }

    var fReg = newObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    var fBold = newObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

    var serBin = b64ToBinary(PDF_SERENUS_JPG);
    var sulBin = b64ToBinary(PDF_SULA_JPG);
    var imSer = newObj("<< /Type /XObject /Subtype /Image /Width " + PDF_SERENUS_W + " /Height " + PDF_SERENUS_H +
      " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + serBin.length + " >>", serBin);
    var imSul = newObj("<< /Type /XObject /Subtype /Image /Width " + PDF_SULA_W + " /Height " + PDF_SULA_H +
      " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + sulBin.length + " >>", sulBin);
    var gsWm = newObj("<< /Type /ExtGState /ca 0.07 >>");

    var C_INK = "0.086 0.129 0.114";
    var C_SOFT = "0.357 0.408 0.376";
    var C_ACC = "0.039 0.310 0.267";
    var C_FAINT = "0.541 0.588 0.561";

    var pages = [];
    var cs = "", y = 0;

    function drawWatermark(){
      var phrase = "SERENUS CORRETORA - MATERIAL EXCLUSIVO";
      var row3 = phrase + "    " + phrase + "    " + phrase;
      var ang = 28 * Math.PI / 180;
      var ca = Math.cos(ang).toFixed(4), sa = Math.sin(ang).toFixed(4), nsa = (-Math.sin(ang)).toFixed(4);
      cs += "q /GS1 gs 0.42 0.45 0.43 rg BT /F2 9 Tf\n";
      for(var row=-3; row<15; row++){
        cs += ca + " " + sa + " " + nsa + " " + ca + " -150 " + (row*58) + " Tm (" + pdfStr(row3) + ") Tj\n";
      }
      cs += "ET Q\n";
    }

    function startPage(isFirst){
      cs = "";
      drawWatermark();
      cs += "q " + C_INK + " rg 0 " + (PDF_H - 5).toFixed(2) + " " + PDF_W.toFixed(2) + " 5 re f Q\n";
      if(isFirst){
        var sw = 96, sh = sw * PDF_SERENUS_H / PDF_SERENUS_W;
        var logoY = PDF_H - 30 - sh;
        cs += "q " + sw.toFixed(2) + " 0 0 " + sh.toFixed(2) + " " + PDF_M + " " + logoY.toFixed(2) + " cm /Im1 Do Q\n";
        var uw = 84, uh = uw * PDF_SULA_H / PDF_SULA_W;
        cs += "q " + uw.toFixed(2) + " 0 0 " + uh.toFixed(2) + " " + (PDF_M + sw + 18).toFixed(2) + " " + (logoY + (sh-uh)/2).toFixed(2) + " cm /Im2 Do Q\n";
        y = logoY - 26;
        cs += "BT /F2 16 Tf " + C_INK + " rg " + PDF_M + " " + y.toFixed(2) + " Td (" + pdfStr(meta.cityLabel) + ") Tj ET\n";
        y -= 15;
        cs += "BT /F1 9 Tf " + C_SOFT + " rg " + PDF_M + " " + y.toFixed(2) + " Td (" + pdfStr(meta.count + " resultados - " + meta.filterLabel) + ") Tj ET\n";
        y -= 22;
      } else {
        cs += "BT /F2 8.5 Tf " + C_SOFT + " rg " + PDF_M + " " + (PDF_H - 24).toFixed(2) + " Td (" + pdfStr("Rede Referenciada - " + meta.cityLabel + " - Serenus Corretora") + ") Tj ET\n";
        y = PDF_H - 46;
      }
      pages.push(null); // placeholder, replaced on endPage
    }

    function endPage(){
      pages[pages.length-1] = cs;
    }

    function ensure(h){
      if(y - h < PDF_M + 8){
        endPage();
        startPage(false);
      }
    }

    function line(text, opt){
      opt = opt || {};
      var size = opt.size || 9, bold = !!opt.bold;
      var color = opt.color || C_INK;
      var gap = opt.gap != null ? opt.gap : 2;
      var maxW = PDF_W - PDF_M*2;
      var lns = pdfWrap(text, maxW, size, bold);
      for(var i=0;i<lns.length;i++){
        ensure(size + gap);
        cs += "BT /" + (bold?"F2":"F1") + " " + size + " Tf " + color + " rg " + PDF_M + " " + y.toFixed(2) + " Td (" + pdfStr(lns[i]) + ") Tj ET\n";
        y -= size + gap;
      }
    }

    function groupTitle(text){
      ensure(30);
      y -= 8;
      cs += "q 0.78 0.82 0.79 RG 0.8 w " + PDF_M + " " + (y+3).toFixed(2) + " m " + (PDF_W-PDF_M).toFixed(2) + " " + (y+3).toFixed(2) + " l S Q\n";
      y -= 5;
      line(text, {size:10, bold:true, color:C_INK, gap:7});
    }

    function record(r){
      ensure(32);
      var fl = [];
      if(r.o) fl.push("Agend. online");
      if(r.v) fl.push("Teleconsulta");
      line(r.n + (fl.length ? "   (" + fl.join(", ") + ")" : ""), {size:9.5, bold:true, gap:1.5});
      var tels = (r.f||[]).map(fmtPhone).join("   ");
      line(r.e + " - " + r.b + " | CEP " + r.c + (tels ? " | " + tels : " | sem telefone informado"), {size:8.2, color:C_SOFT, gap:1.5});
      if(r.s && r.s.length) line(r.s.join(", "), {size:7.9, color:C_ACC, gap:6});
      else y -= 6;
    }

    startPage(true);

    if(meta.tipoAll){
      ["ps","hm","hd","mc"].forEach(function(t){
        var grp = records.filter(function(r){ return r.t === t; });
        if(!grp.length) return;
        groupTitle(PDF_TIPO_LABEL[t] + " (" + grp.length + ")");
        grp.forEach(record);
      });
    } else {
      records.forEach(record);
    }

    ensure(58);
    y -= 10;
    cs += "q 0.78 0.82 0.79 RG 0.8 w " + PDF_M + " " + (y+4).toFixed(2) + " m " + (PDF_W-PDF_M).toFixed(2) + " " + (y+4).toFixed(2) + " l S Q\n";
    y -= 6;
    line("Material exclusivo Serenus Corretora de Saude - uso interno, nao redistribuir.", {size:7.4, bold:true, color:C_INK, gap:2.5});
    line("Fonte: busca publica de rede referenciada SulAmerica (portal.sulamericaseguros.com.br). Plano Direto Nacional 557 / 87507. Gerado em " + meta.dateStr + ".", {size:7, color:C_FAINT, gap:2.5});
    line("Cada consulta ao site da operadora retorna no maximo 50 prestadores por ponto; a coleta varreu multiplos pontos e todas as especialidades, mas em especialidades de altissimo volume a lista pode nao ser exaustiva. Confirme cobertura com o prestador.", {size:7, color:C_FAINT, gap:2.5});
    endPage();

    // objetos de pagina
    var contentNums = pages.map(function(c){ return newObj("<< /Length " + c.length + " >>", c); });
    var pageNums = [];
    contentNums.forEach(function(cn){
      var res = "<< /Font << /F1 " + fReg + " 0 R /F2 " + fBold + " 0 R >> " +
        "/XObject << /Im1 " + imSer + " 0 R /Im2 " + imSul + " 0 R >> " +
        "/ExtGState << /GS1 " + gsWm + " 0 R >> >>";
      pageNums.push(newObj("<< /Type /Page /Parent __PAGES__ /MediaBox [0 0 " + PDF_W + " " + PDF_H + "] /Resources " + res + " /Contents " + cn + " 0 R >>"));
    });
    var pagesNum = newObj("<< /Type /Pages /Kids [" + pageNums.map(function(n){return n + " 0 R";}).join(" ") + "] /Count " + pageNums.length + " >>");
    objects.forEach(function(o, i){
      if(o.dict && o.dict.indexOf("__PAGES__") !== -1){
        objects[i].dict = o.dict.replace("__PAGES__", pagesNum + " 0 R");
      }
    });
    var catNum = newObj("<< /Type /Catalog /Pages " + pagesNum + " 0 R >>");
    var infoNum = newObj("<< /Title (" + pdfStr("Rede Referenciada - " + meta.cityLabel + " - Serenus Corretora") + ") /Author (" + pdfStr("Serenus Corretora de Saude") + ") /Creator (" + pdfStr("Serenus - Rede Referenciada") + ") >>");

    var head = "%PDF-1.4\n%âãÏÓ\n";
    var chunks = [head];
    var offsets = [0];
    var pos = head.length;
    for(var i=0;i<objects.length;i++){
      var num = i+1, o = objects[i], body;
      if(o.data != null) body = num + " 0 obj\n" + o.dict + "\nstream\n" + o.data + "\nendstream\nendobj\n";
      else body = num + " 0 obj\n" + o.dict + "\nendobj\n";
      offsets[num] = pos;
      chunks.push(body);
      pos += body.length;
    }
    var xrefStart = pos;
    var xref = "xref\n0 " + (objects.length+1) + "\n0000000000 65535 f \n";
    for(var j=1;j<=objects.length;j++){
      var s = String(offsets[j]);
      while(s.length < 10) s = "0" + s;
      xref += s + " 00000 n \n";
    }
    var trailer = "trailer\n<< /Size " + (objects.length+1) + " /Root " + catNum + " 0 R /Info " + infoNum + " 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF";

    var full = chunks.join("") + xref + trailer;
    var bytes = new Uint8Array(full.length);
    for(var k=0;k<full.length;k++){ bytes[k] = full.charCodeAt(k) & 0xFF; }
    return new Blob([bytes], {type:"application/pdf"});
  }

  function slugify(s){
    return String(s).toLowerCase()
      .replace(/[àáâãä]/g,"a").replace(/[èéêë]/g,"e").replace(/[ìíîï]/g,"i")
      .replace(/[òóôõö]/g,"o").replace(/[ùúûü]/g,"u").replace(/ç/g,"c")
      .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
  }

  // Entrega o PDF. Dentro de um iframe com sandbox (caso do artifact) o navegador
  // BLOQUEIA <a download>, sem lancar erro. Por isso a ordem: abrir numa aba real
  // (sem sandbox, onde salvar funciona normal) e, se o popup for barrado, mostrar
  // o PDF num visualizador dentro da propria pagina.
  function deliverPdf(blob, filename, count){
    var url = URL.createObjectURL(blob);
    var win = null;
    try { win = window.open(url, "_blank"); } catch(e){ win = null; }

    if(win){
      showToast("PDF de " + count + " locais aberto em nova aba — use Salvar/Compartilhar por lá.");
      setTimeout(function(){ URL.revokeObjectURL(url); }, 120000);
      return;
    }
    showPdfViewer(url, filename, count);
  }

  function showPdfViewer(url, filename, count){
    var old = document.getElementById("pdfviewer");
    if(old) old.parentNode.removeChild(old);

    var ov = document.createElement("div");
    ov.id = "pdfviewer";
    ov.innerHTML =
      '<div class="pv-bar">' +
        '<div class="pv-title">' + escapeHtml(filename) + ' <span>' + count + ' locais</span></div>' +
        '<div class="pv-acts">' +
          '<a class="pv-btn pv-primary" id="pvSave" href="' + url + '" download="' + escapeHtml(filename) + '">Salvar</a>' +
          '<button class="pv-btn" id="pvClose" type="button">Fechar</button>' +
        '</div>' +
      '</div>' +
      '<div class="pv-hint">Se o botao Salvar nao funcionar, use o botao de download/compartilhar do visualizador de PDF abaixo.</div>' +
      '<iframe class="pv-frame" src="' + url + '" title="PDF"></iframe>';
    document.body.appendChild(ov);

    document.getElementById("pvClose").addEventListener("click", function(){
      ov.parentNode.removeChild(ov);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    });
    showToast("PDF de " + count + " locais pronto.");
  }

  function exportPdf(){
    var recs = currentRecords().filter(matches);
    if(recs.length === 0){
      showToast("Nenhum resultado para gerar PDF. Ajuste a busca ou os filtros.");
      return;
    }
    var btn = document.getElementById("pdfbtn");
    btn.disabled = true;
    var prevLabel = btn.innerHTML;
    btn.innerHTML = "Gerando…";
    showToast("Gerando PDF com " + recs.length + " locais…");

    setTimeout(function(){
      try{
        var now = new Date();
        var dateStr = now.toLocaleDateString("pt-BR") + " as " + now.toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit"});
        var meta = {
          cityLabel: DB[state.city].label,
          filterLabel: filterLabel(),
          count: recs.length,
          tipoAll: state.tipo === "all",
          dateStr: dateStr
        };
        var blob = buildPdfBlob(recs, meta);
        var name = "rede-sulamerica-" + slugify(DB[state.city].label) +
          (state.esp !== "all" ? "-" + slugify(state.esp) : "") +
          (state.tipo !== "all" ? "-" + state.tipo : "") + ".pdf";
        deliverPdf(blob, name, recs.length);
      } catch(e){
        showToast("Falha ao gerar o PDF: " + (e && e.message ? e.message : e));
      } finally {
        btn.disabled = false;
        btn.innerHTML = prevLabel;
      }
    }, 30);
  }

  document.getElementById("pdfbtn").addEventListener("click", exportPdf);
