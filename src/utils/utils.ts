import Compressor from "compressorjs"

export async function imageToBase64(image: Blob | File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
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

export function checkBlobSize(blob: Blob, max_size: number = 200): boolean {
    const imageSize = blobSizeInKB(blob);
    
    if (imageSize > max_size) return false;
    else return true;
}

export function getBlobSizeFromBase64(base64String: string): number {
    const bytes = Math.ceil((base64String.length * 3) / 4);
    const kb = bytes / 1024;
    return kb;
}

export function checkBase64Size(base64String: string, max_size: number = 200): boolean {
    const imageSize = getBlobSizeFromBase64(base64String);

    if (imageSize > max_size) return false;
    else return true;
}

export async function toWebp(blob: Blob): Promise<Blob> {
    const img = new Image();
    img.src = URL.createObjectURL(blob);

    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);

    // export as WebP
    return new Promise<Blob>((resolve) => {
        canvas.toBlob((resBlob) => {
            resolve(resBlob!);
        }, 'image/webp');
    });
}

export async function compressWebpBlob(blob: Blob, quality: number = 0.8): Promise<Blob> {
    return new Promise((resolve, reject) => {
        new Compressor(blob, {
            quality: quality, // 0.0 (max compression) - 1.0
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

export async function showBlobImage(blob: Blob): Promise<void> {
    const url = URL.createObjectURL(blob);

    const img = document.createElement('img');
    img.src = url;
    img.style.maxWidth = '350px';
    document.getElementById('imagesContainer')?.appendChild(img);

    img.onload = () => URL.revokeObjectURL(url);
}
