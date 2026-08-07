import requests

r = requests.get("https://ocr.geoplanetsolution.in/")
print(r.text)
