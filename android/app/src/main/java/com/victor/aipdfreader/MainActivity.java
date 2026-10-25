package com.victor.aipdfreader;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import java.io.InputStream;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private Uri currentPdfUri = null;
    private String currentPdfName = "Document.pdf";
    private boolean isPageLoaded = false;
    private final static int PICK_PDF_REQUEST = 2002;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);

        // Expose native bridge to Javascript
        webView.addJavascriptInterface(new NativeInterface(), "AndroidBridge");

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                isPageLoaded = true;
                // If the app was opened with a PDF, load it now
                if (currentPdfUri != null) {
                    dispatchCurrentPdfToJs();
                }
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url != null && url.getPath() != null && url.getPath().endsWith("current_pdf_stream")) {
                    if (currentPdfUri != null) {
                        try {
                            InputStream is = getContentResolver().openInputStream(currentPdfUri);
                            return new WebResourceResponse("application/pdf", "binary", is);
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }
        });

        // Handle initial intent if app was launched by tapping a PDF
        handleIntent(getIntent());

        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
        if (isPageLoaded && currentPdfUri != null) {
            dispatchCurrentPdfToJs();
        }
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Uri data = intent.getData();

        if (Intent.ACTION_VIEW.equals(action) && data != null) {
            currentPdfUri = data;
            currentPdfName = extractFileName(data);
        }
    }

    private String extractFileName(Uri uri) {
        String result = "Document.pdf";
        if ("content".equals(uri.getScheme())) {
            try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (nameIndex >= 0) {
                        result = cursor.getString(nameIndex);
                    }
                }
            } catch (Exception ignored) {}
        }
        if (result == null || result.isEmpty()) {
            result = uri.getLastPathSegment();
        }
        return (result != null && !result.isEmpty()) ? result : "Document.pdf";
    }

    private void dispatchCurrentPdfToJs() {
        if (currentPdfUri == null) return;
        final String safeName = currentPdfName.replace("'", "\\'");
        // Ask PDF.js to load via the intercepted URL
        final String js = "if (window.app && window.app.loadPdfFromUrl) { window.app.loadPdfFromUrl('current_pdf_stream', '" + safeName + "'); }";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    public class NativeInterface {
        @JavascriptInterface
        public void openNativePdfPicker() {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/pdf");
            startActivityForResult(intent, PICK_PDF_REQUEST);
        }

        @JavascriptInterface
        public boolean isAndroidApp() {
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_PDF_REQUEST && resultCode == RESULT_OK && data != null) {
            Uri uri = data.getData();
            if (uri != null) {
                try {
                    getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (Exception ignored) {}
                currentPdfUri = uri;
                currentPdfName = extractFileName(uri);
                dispatchCurrentPdfToJs();
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
