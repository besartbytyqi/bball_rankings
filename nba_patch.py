"""
nba_patch.py — Monkey-patches nba_api to use curl_cffi with Chrome TLS impersonation.

stats.nba.com uses bot detection that fingerprints the TLS Client Hello (JA3/JA4).
Python's requests library produces a non-browser fingerprint and gets silently blocked.
curl_cffi impersonates Chrome's exact TLS fingerprint, bypassing the block.

Import this module before any nba_api imports.
"""
import curl_cffi.requests as _cffi_requests
import nba_api.library.http as _nba_http


class _ChromeRequests:
    """Drop-in replacement for `requests` that impersonates Chrome120 TLS."""

    @staticmethod
    def get(url, **kwargs):
        kwargs.setdefault("impersonate", "chrome120")
        return _cffi_requests.get(url, **kwargs)


# Swap out the requests module used by every nba_api HTTP call
_nba_http.requests = _ChromeRequests()
