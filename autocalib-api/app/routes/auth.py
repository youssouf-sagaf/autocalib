"""Firebase auth handoff — Cocopilot SSO into Autocalib."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.services.auth_handoff import create_handoff_code, exchange_handoff_code

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class HandoffCreateResponse(BaseModel):
    code: str
    expires_in_sec: int = 60


class HandoffExchangeRequest(BaseModel):
    code: str = Field(..., min_length=8, max_length=256)


class HandoffExchangeResponse(BaseModel):
    custom_token: str


def _bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    return token


@router.post("/handoff", response_model=HandoffCreateResponse)
async def create_handoff(
    request: Request,
    authorization: str | None = Header(None),
) -> HandoffCreateResponse:
    """Issue a one-time code for Autocalib (Cocopilot staff, valid Firebase ID token)."""
    id_token = _bearer_token(authorization)
    client_host = request.client.host if request.client else "unknown"
    code = await create_handoff_code(id_token, client_key=client_host)
    return HandoffCreateResponse(code=code)


@router.post("/handoff/exchange", response_model=HandoffExchangeResponse)
async def exchange_handoff(body: HandoffExchangeRequest) -> HandoffExchangeResponse:
    """Exchange a handoff code for a Firebase custom token."""
    custom_token = exchange_handoff_code(body.code)
    return HandoffExchangeResponse(custom_token=custom_token)
