import Compressor from "compressorjs"

export function imageToBase64(image: Blob | File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error("Unknown FileReader error"));
        reader.readAsDataURL(image);
    });
}

export function base64ToBlob(base64: string): Blob {
    const [header, data] = base64.split(',');
    const binary = atob(data);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        array[i] = binary.charCodeAt(i);
    }
    return new Blob([array], { type: header.match(/:(.*?);/)![1] });
}

export function blobSizeInKB(blob: Blob): number {
    return (blob.size / 1024);
}

export function showBlobTypeDimSize(blob: Blob, imageType: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        const sizeKB = blobSizeInKB(blob);

        img.onload = () => {
            console.log(`[${imageType} image] Type: ${blob.type}, Dimensions: ${img.naturalWidth}x${img.naturalHeight}px, Size: ${sizeKB.toFixed(2)} KB`);
            resolve();
        };
        img.onerror = (e) => reject(e);
    });
}

export function checkBlobSize(blob: Blob, max_size: number = 200): boolean {
    const imageSize = blobSizeInKB(blob);
    return imageSize <= max_size;
}

export async function toWebp(blob: Blob): Promise<Blob> {
    const img = new Image();
    img.src = URL.createObjectURL(blob);

    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Unable to load image"));
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);

    // export as WebP
    return new Promise<Blob>((resolve) => {
        canvas.toBlob(
            (resBlob) => resolve(resBlob!),
            'image/webp'
        );
    });
}

export async function reduceResolution(blob: Blob, maxDimension: number = 600, format: 'image/webp' | 'image/jpeg' | 'image/png' = 'image/png'): Promise<Blob> {
    const img = new Image();
    img.src = URL.createObjectURL(blob);

    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Unable to load image"));
    });

    let width = img.width;
    let height = img.height;

    if (width > height) {
        if (width > maxDimension) {
            height = Math.round(height * (maxDimension / width));
            width = maxDimension;
        }
    } else {
        if (height > maxDimension) {
            width = Math.round(width * (maxDimension / height));
            height = maxDimension;
        }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, width, height);

    return new Promise<Blob>((resolve) => {
        canvas.toBlob(
            (resBlob) => resolve(resBlob!),
            format
        );
    });
}

export function getImgDimensions(base64Img: string): Promise<{ x: number; y: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ x: img.naturalWidth, y: img.naturalHeight });
        img.onerror = (e) => reject(e);
        img.src = base64Img;
    });
}

export function compressWebpBlob(blob: Blob, quality: number = 0.8): Promise<Blob> {
    return new Promise((resolve, reject) => {
        new Compressor(blob, {
            quality: quality, // 0.0 (max compression) - 1.0 (no compression)
            convertSize: Infinity,
            success(result) {
                resolve(result);
            },
            error(err) {
                reject(err);
            }
        });
    });
}

export function mapLangCodeToName(langCode: string): string {
  const map: Record<string, string> = {
    "en-US": "English (US)",
    "en-GB": "English (UK)",
    "en-AU": "English (Australia)",
    "it-IT": "Italian",
    "fr-FR": "French",
    "es-ES": "Spanish"
  };

  return map[langCode] || "English (US)";
}

export async function drawPointedPosition(base64Img: string, x: number | null, y: number | null, radius: number = 9): Promise<string> {
    if (x === null || y === null) return base64Img;

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = base64Img;

        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            const ctx = canvas.getContext("2d");
            if (!ctx) return reject("Canvas context not available");

            ctx.drawImage(img, 0, 0); // draw original image

            // draw pointed position
            ctx.fillStyle = "rgba(255, 0, 0, 0.75)";
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();

            const mimeMatch = base64Img.match(/^data:(image\/[a-zA-Z]+);base64,/);
            const mimeType = mimeMatch ? mimeMatch[1] : "image/png";

            const resultBase64 = canvas.toDataURL(mimeType);
            resolve(resultBase64);
        };

        img.onerror = (e) => reject(e);
    });
}

export async function base64ToGrayScale(base64Img: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = base64Img;

        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            const ctx = canvas.getContext("2d");
            if (!ctx) return reject("Canvas context not available");
            ctx.drawImage(img, 0, 0);

            //  get pixel data
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imgData.data;

            // conversion formula
            let rW = 0.2126, gW = 0.7152, bW = 0.0722;

            // pixel-by-pixel conversion
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const gray = Math.round(r * rW + g * gW + b * bW);

                data[i] = gray;
                data[i + 1] = gray;
                data[i + 2] = gray;
            }

            ctx.putImageData(imgData, 0, 0);

            const mimeMatch = base64Img.match(/^data:(image\/[a-zA-Z]+);base64,/);
            const mimeType = mimeMatch ? mimeMatch[1] : "image/webp";

            const resultBase64 = canvas.toDataURL(mimeType);
            resolve(resultBase64);
        };

        img.onerror = (e) => reject(e);
    });
}