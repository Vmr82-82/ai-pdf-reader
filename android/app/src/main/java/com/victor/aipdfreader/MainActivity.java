package com.victor.aipdfreader;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends AppCompatActivity {
    private static final String TAG = "MainActivity";
    private WebView webView;
    private Uri currentPdfUri = null;
    private String currentPdfName = "Document.pdf";
    private boolean isJsReady = false;
    private final static int PICK_PDF_REQUEST = 2002;
    private WebViewAssetLoader assetLoader;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        // Configure asset loader to serve local assets over https://appassets.androidplatform.net/assets/
        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

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
                if (isJsReady && currentPdfUri != null) {
                    dispatchCurrentPdfToJs();
                }
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url != null && url.getPath() != null) {
                    String path = url.getPath();
                    if (path.contains("current_pdf_stream")) {
                        if (currentPdfUri != null) {
                            try {
                                InputStream is = getContentResolver().openInputStream(currentPdfUri);
                                if (is != null) {
                                    Map<String, String> headers = new HashMap<>();
                                    headers.put("Access-Control-Allow-Origin", "*");
                                    headers.put("Access-Control-Allow-Methods", "GET, OPTIONS");
                                    headers.put("Accept-Ranges", "none");
                                    headers.put("Content-Type", "application/pdf");
                                    return new WebResourceResponse("application/pdf", null, 200, "OK", headers, is);
                                }
                            } catch (Exception e) {
                                Log.e(TAG, "Error opening PDF stream", e);
                            }
                        }
                    } else if (path.endsWith(".mjs")) {
                        // Ensure correct MIME type for ES modules
                        try {
                            String assetPath = path.replaceFirst("^/assets/", "");
                            InputStream is = getAssets().open(assetPath);
                            Map<String, String> headers = new HashMap<>();
                            headers.put("Access-Control-Allow-Origin", "*");
                            return new WebResourceResponse("application/javascript", "UTF-8", 200, "OK", headers, is);
                        } catch (Exception ignored) {}
                    }
                }
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });

        // Handle initial intent if app was launched by tapping a PDF
        handleIntent(getIntent());

        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
        if (isJsReady && currentPdfUri != null) {
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
            try {
                int flags = intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
                if (flags != 0) {
                    getContentResolver().takePersistableUriPermission(data, flags);
                }
            } catch (Exception ignored) {}
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
        final String url = "https://appassets.androidplatform.net/assets/current_pdf_stream?t=" + System.currentTimeMillis();
        final String js = "if (window.app && window.app.loadPdfFromUrl) { window.app.loadPdfFromUrl('" + url + "', '" + safeName + "'); }";
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

        @JavascriptInterface
        public boolean hasPendingPdf() {
            return currentPdfUri != null;
        }

        @JavascriptInterface
        public String getPendingPdfName() {
            return currentPdfName;
        }

        @JavascriptInterface
        public void notifyAppReady() {
            isJsReady = true;
            if (currentPdfUri != null) {
                dispatchCurrentPdfToJs();
            }
        }

        @JavascriptInterface
        public String getPdfBase64() {
            if (currentPdfUri == null) return "";
            try (InputStream is = getContentResolver().openInputStream(currentPdfUri);
                 ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                if (is == null) return "";
                byte[] buffer = new byte[16384];
                int read;
                while ((read = is.read(buffer)) != -1) {
                    baos.write(buffer, 0, read);
                }
                return Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
            } catch (Exception e) {
                Log.e(TAG, "Error encoding PDF as Base64", e);
                return "";
            }
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
