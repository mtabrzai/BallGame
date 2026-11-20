package com.neonbounce.tv

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val prefs by lazy { getSharedPreferences("neonbounce", MODE_PRIVATE) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        )
        webView = WebView(this)
        setContentView(webView)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) promptForUrl()
            }
        }
        webView.webChromeClient = WebChromeClient()
        webView.setOnKeyListener { _, keyCode, event ->
            if (event.action == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_BACK) {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    finish()
                }
                true
            } else {
                false
            }
        }
        loadSavedUrl()
    }

    private fun loadSavedUrl() {
        val url = intent.getStringExtra("url") ?: prefs.getString("url", null)
        if (url.isNullOrEmpty()) {
            promptForUrl()
        } else {
            webView.loadUrl(url)
        }
    }

    private fun promptForUrl() {
        val input = EditText(this).apply {
            setText(prefs.getString("url", getString(R.string.default_url)))
            setSelection(text.length)
        }
        AlertDialog.Builder(this)
            .setTitle("Server address")
            .setMessage("Enter the Neon Bounce server URL (device and server on the same Wi-Fi):")
            .setView(input)
            .setPositiveButton("Connect") { _, _ ->
                val raw = input.text.toString().trim().removeSuffix("/")
                val url = if (raw.startsWith("http")) raw else "http://$raw"
                prefs.edit().putString("url", url).apply()
                webView.loadUrl(url)
            }
            .setNegativeButton("Cancel") { _, _ ->
                if (prefs.getString("url", null).isNullOrEmpty()) finish()
            }
            .setCancelable(false)
            .show()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            promptForUrl()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
