"""
haimtran 12/03/2024
"""

import os

# parameters
REGION = "us-west-2"
ACCOUNT = os.popen("aws sts get-caller-identity | jq -r '.Account'").read().strip()
APP_NAME = "go-blue-green-app"

# delete all docker images
os.system("sudo docker system prune -a")

# build go-blog-app image
os.system(f"sudo docker build -t {APP_NAME} . ")

#  aws ecr login
os.system(
    f"aws ecr get-login-password --region {REGION} | sudo docker login --username AWS --password-stdin {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com"
)

# get image id
IMAGE_ID = os.popen(f"sudo docker images -q {APP_NAME}:latest").read()

# tag {APP_NAME} image
os.system(
    f"sudo docker tag {IMAGE_ID.strip()} {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/{APP_NAME}:latest"
)

# create ecr repository
os.system(
    f"aws ecr create-repository --registry-id {ACCOUNT} --repository-name {APP_NAME} --region {REGION}"
)

# push image to ecr
os.system(
    f"sudo docker push {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/{APP_NAME}:latest"
)

# run locally to test
# os.system(f"sudo docker run -d -p 3001:3000 {APP_NAME}:latest")