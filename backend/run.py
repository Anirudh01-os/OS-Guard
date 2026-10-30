"""Start the API (and the built frontend, if present) on http://127.0.0.1:8000."""
import uvicorn

if __name__ == "__main__":
    uvicorn.run("osguard.main:app", host="127.0.0.1", port=8000, log_level="info")
