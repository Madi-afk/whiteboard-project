import asyncio
import json
from typing import Any

import boto3
from botocore.exceptions import ClientError


MINIO_ENDPOINT = "http://localhost:9000"
MINIO_ACCESS_KEY = "minioadmin"
MINIO_SECRET_KEY = "minioadmin"
MINIO_BUCKET = "whiteboards"


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=MINIO_ENDPOINT,
        aws_access_key_id=MINIO_ACCESS_KEY,
        aws_secret_access_key=MINIO_SECRET_KEY,
    )


def ensure_bucket_sync():
    s3 = get_s3_client()

    try:
        s3.head_bucket(Bucket=MINIO_BUCKET)
    except ClientError:
        s3.create_bucket(Bucket=MINIO_BUCKET)


async def ensure_bucket():
    await asyncio.to_thread(ensure_bucket_sync)


def save_board_sync(room_id: str, data: dict[str, Any]):
    s3 = get_s3_client()

    s3.put_object(
        Bucket=MINIO_BUCKET,
        Key=f"{room_id}.json",
        Body=json.dumps(data),
        ContentType="application/json",
    )


async def save_board(room_id: str, data: dict[str, Any]):
    await asyncio.to_thread(save_board_sync, room_id, data)


def load_board_sync(room_id: str) -> dict[str, Any] | None:
    s3 = get_s3_client()

    try:
        response = s3.get_object(
            Bucket=MINIO_BUCKET,
            Key=f"{room_id}.json",
        )

        content = response["Body"].read().decode("utf-8")
        return json.loads(content)

    except ClientError as error:
        error_code = error.response.get("Error", {}).get("Code")

        if error_code in ["NoSuchKey", "404"]:
            return None

        raise


async def load_board(room_id: str) -> dict[str, Any] | None:
    return await asyncio.to_thread(load_board_sync, room_id)