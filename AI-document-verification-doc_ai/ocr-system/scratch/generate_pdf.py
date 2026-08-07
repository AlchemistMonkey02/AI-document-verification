def generate_minimal_pdf(filename):
    # Stream content
    stream_content = (
        "BT\n"
        "/F1 12 Tf\n"
        "72 712 Td\n"
        "(Completion Certificate) Tj\n"
        "0 -20 Td\n"
        "(Work Name: GP Road Construction) Tj\n"
        "0 -20 Td\n"
        "(Completion Date: 2026-07-31) Tj\n"
        "0 -20 Td\n"
        "(Authority Signature: Block Development Officer) Tj\n"
        "0 -20 Td\n"
        "(Level: GP) Tj\n"
        "ET"
    )
    
    # We will build objects and calculate offsets
    objects = []
    
    # Obj 1: Catalog
    objects.append("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    # Obj 2: Pages
    objects.append("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
    # Obj 3: Page
    objects.append("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n")
    # Obj 4: Font
    objects.append("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")
    # Obj 5: Content Stream
    stream_bytes = stream_content.encode('ascii')
    objects.append(f"5 0 obj\n<< /Length {len(stream_bytes)} >>\nstream\n{stream_content}\nendstream\nendobj\n")
    
    # Write PDF
    with open(filename, 'wb') as f:
        f.write(b"%PDF-1.4\n")
        
        offsets = []
        current_offset = 9  # length of "%PDF-1.4\n"
        
        for obj in objects:
            offsets.append(current_offset)
            obj_bytes = obj.encode('ascii')
            f.write(obj_bytes)
            current_offset += len(obj_bytes)
            
        # Write xref
        xref_start = current_offset
        f.write(b"xref\n")
        f.write(f"0 {len(objects) + 1}\n".encode('ascii'))
        f.write(b"0000000000 65535 f \n")
        for offset in offsets:
            f.write(f"{offset:010d} 00000 n \n".encode('ascii'))
            
        f.write(b"trailer\n")
        f.write(f"<< /Size {len(objects) + 1} /Root 1 0 R >>\n".encode('ascii'))
        f.write(b"startxref\n")
        f.write(f"{xref_start}\n".encode('ascii'))
        f.write(b"%%EOF\n")

if __name__ == "__main__":
    pdf_name = "test_completion.pdf"
    generate_minimal_pdf(pdf_name)
    
    # Test reading it back
    import pdfplumber
    with pdfplumber.open(pdf_name) as pdf:
        text = pdf.pages[0].extract_text()
        print("Extracted Text:")
        print(text)
