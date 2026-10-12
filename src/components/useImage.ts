import { useEffect, useState } from "react";

export function useImage(src?: string): HTMLImageElement | undefined {
  const [img, setImg] = useState<HTMLImageElement | undefined>(undefined);
  useEffect(() => {
    if (!src) {
      setImg(undefined);
      return;
    }
    const image = new Image();
    let active = true;
    image.onload = () => {
      if (active) setImg(image);
    };
    image.src = src;
    return () => {
      active = false;
    };
  }, [src]);
  return img;
}
