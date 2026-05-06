#build and push docker images to AWS
echo "Login to ECR Repository"
echo "Preparation task"
aws configure
aws ecr get-login-password | docker login --username AWS --password-stdin $DOCKER_REGISTRY

echo "Build App Docker Image"
docker build --build-arg DEPLOYMENT_ID=${CI_PIPELINE_ID} -t $DOCKER_REGISTRY/$REPO:$PREFIX-$CI_PIPELINE_ID -f e2e/dashboard/Dockerfile e2e/dashboard
echo "Push App Image to ECR"
docker push $DOCKER_REGISTRY/$REPO:$PREFIX-$CI_PIPELINE_ID
