import os
import pytesseract
from PIL import Image

def inspect_pages():
    base_dir = r"c:\Users\DELL\Desktop\New folder\AI-document-verification-doc_ai\AI-document-verification-doc_ai\ocr-system"
    for i in range(1, 11):
        img_name = f"PAI 2.0-{i:02d}.png"
        img_path = os.path.join(base_dir, img_name)
        if not os.path.exists(img_path):
            img_name = f"PAI 2.0-{i}.png"
            img_path = os.path.join(base_dir, img_name)

        if not os.path.exists(img_path):
            continue

        print(f"\n==========================================")
        print(f"Inspecting Image: {img_name}")
        img = Image.open(img_path)
        print("Image size:", img.size)

        # Test 4 rotation angles: 0, 90, 180, 270
        for angle in [0, 90, 180, 270]:
            rotated = img.rotate(angle, expand=True)
            text = pytesseract.image_to_string(rotated, lang='eng+hin')
            lower = text.lower()
            
            keywords = ["attendance", "capacity", "building", "training", "sheet", "rajasthan", "उपस्थिति"]
            hits = [kw for kw in keywords if kw in lower]
            if hits:
                print(f"  --> Angle {angle}° HIT! Keywords found: {hits}")
                print("  Snippet:", text.replace("\n", " ")[:200])

if __name__ == "__main__":
    inspect_pages()
