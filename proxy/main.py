from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import litellm
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

LLM_MODEL = os.environ["LLM_MODEL"]
LLM_API_KEY = os.environ.get("LLM_API_KEY")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL")


@app.post("/llm/chat/completions")
async def proxy_llm(request: Request):
    body = await request.json()
    try:
        response = await litellm.acompletion(
            model=LLM_MODEL,
            messages=body["messages"],
            tools=body.get("tools"),
            tool_choice="auto" if body.get("tools") else None,
            api_key=LLM_API_KEY,
            api_base=LLM_BASE_URL,
        )
        return JSONResponse(content=response.model_dump())
    except litellm.AuthenticationError as e:
        return JSONResponse(
            status_code=401,
            content={"error": {"message": str(e), "type": "authentication_error"}},
        )
    except litellm.RateLimitError as e:
        return JSONResponse(
            status_code=429,
            content={"error": {"message": str(e), "type": "rate_limit_error"}},
        )
    except litellm.BadRequestError as e:
        return JSONResponse(
            status_code=400,
            content={"error": {"message": str(e), "type": "bad_request_error"}},
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": {"message": str(e), "type": "provider_error"}},
        )


@app.get("/health")
async def health():
    return {"ok": True}
