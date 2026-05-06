#!/bin/sh

echo "Login to ECR Repository"
echo "Preparation task"
echo "Build Docker Image"
aws configure
docker build --build-arg DEPLOYMENT_ID=${CI_PIPELINE_ID} -t $DOCKER_REGISTRY/$REPO:$PREFIX-$CI_PIPELINE_ID -f Dockerfile e2e/dashboard

echo "Push to ECR Repository"
docker push $DOCKER_REGISTRY/$REPO:$PREFIX-$CI_PIPELINE_ID