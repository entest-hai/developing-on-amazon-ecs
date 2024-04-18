cdk bootstrap aws://334308452580/us-west-2
cdk --app 'npx ts-node --prefer-ts-exts bin/ecs-blue-green-app.ts' synth
# cdk --app 'npx ts-node --prefer-ts-exts bin/ecs-blue-green-app.ts' deploy EcrStack
# cdk --app 'npx ts-node --prefer-ts-exts bin/ecs-blue-green-app.ts' deploy NetworkStack
# cdk --app 'npx ts-node --prefer-ts-exts bin/ecs-blue-green-app.ts' deploy AlbStack 
# cdk --app 'npx ts-node --prefer-ts-exts bin/ecs-blue-green-app.ts' deploy EcsClusterStack 
# cdk --app 'npx ts-node --prefer-ts-exts bin/ecs-blue-green-app.ts' deploy DeploymentGroupStack 
# cdk --app 'npx ts-node --prefer-ts-exts bin/ecs-blue-green-app.ts' deploy CodePipelineStack 
