import json
import sys

from ddgs.ddgs import DDGS

DDGS.threads = 2

TIMEOUT_SECONDS = 8


def to_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def text_results(ddgs, query, max_results):
    results = []
    for item in ddgs.text(query, max_results=max_results):
        url = item.get("href") or item.get("url")
        if not url:
            continue
        results.append(
            {
                "title": item.get("title") or "",
                "url": url,
                "snippet": item.get("body") or item.get("snippet") or "",
            }
        )
    return results


def image_results(ddgs, query, max_results):
    results = []
    for item in ddgs.images(query, max_results=max_results, backend="bing"):
        image = item.get("image")
        if not image:
            continue
        result = {
            "title": item.get("title") or "",
            "imageUrl": image,
            "thumbnailUrl": item.get("thumbnail"),
            "pageUrl": item.get("url"),
            "width": to_int(item.get("width")),
            "height": to_int(item.get("height")),
            "source": item.get("source"),
        }
        results.append({key: value for key, value in result.items() if value is not None})
    return results


def main():
    request = json.loads(sys.stdin.readline())
    action = request.get("action")
    query = request.get("query")
    max_results = int(request.get("maxResults") or 8)
    with DDGS(timeout=TIMEOUT_SECONDS) as ddgs:
        if action == "text":
            results = text_results(ddgs, query, max_results)
        elif action == "images":
            results = image_results(ddgs, query, max_results)
        else:
            raise ValueError(f"Unknown search action: {action}")
    json.dump({"ok": True, "results": results}, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        json.dump({"ok": False, "error": str(error)}, sys.stdout)
        sys.stdout.write("\n")
        sys.exit(1)
