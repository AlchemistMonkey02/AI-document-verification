import requests
import json

url = "http://localhost:5030/verify-document"
files = {'file': open('valid_cte.txt', 'rb')}
data = {
    'documentType': 'DOC_EC_CTE',
    'user_input': json.dumps({
        "project_name": "Alpha Tech Park",
        "consent_number": "CTE-2023-001",
        "issue_date": "12-05-2023"
    })
}

try:
    print("Testing verification with User Input...")
    response = requests.post(url, files=files, data=data)
    print("Status Code:", response.status_code)
    try:
        print("Response:", json.dumps(response.json(), indent=2))
    except:
        print("Raw Response:", response.text)
except Exception as e:
    print("Error:", e)
