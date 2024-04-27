import { Stack, StackProps } from "aws-cdk-lib";
import * as aws_ecs from "aws-cdk-lib/aws-ecs";
import * as aws_elasticloadbalancingv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as aws_codedeploy from "aws-cdk-lib/aws-codedeploy";
import { Construct } from "constructs";

interface EcsDeploymentProps extends StackProps {
  service: aws_ecs.FargateService;
  blueTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;
  greenTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;
  listener: aws_elasticloadbalancingv2.ApplicationListener;
}

export class EcsDeploymentGroup extends Stack {
  public readonly deploymentGroup: aws_codedeploy.EcsDeploymentGroup;

  constructor(scope: Construct, id: string, props: EcsDeploymentProps) {
    super(scope, id, props);

    const service = props.service;
    const blueTargetGroup = props.blueTargetGroup;
    const greenTargetGroup = props.greenTargetGroup;
    const listener = props.listener;

    this.deploymentGroup = new aws_codedeploy.EcsDeploymentGroup(
      this,
      "BlueGreenDeploymentGroup",
      {
        service: service,
        blueGreenDeploymentConfig: {
          blueTargetGroup,
          greenTargetGroup,
          listener,
        },
        deploymentConfig: aws_codedeploy.EcsDeploymentConfig.ALL_AT_ONCE,
      }
    );
  }
}
