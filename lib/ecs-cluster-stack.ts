import { Stack, StackProps, IAspect, Aspects } from "aws-cdk-lib";
import * as aws_ec2 from "aws-cdk-lib/aws-ec2";
import * as aws_ecs from "aws-cdk-lib/aws-ecs";
import { Construct, IConstruct } from "constructs";

interface EcsClusterProps extends StackProps {
  vpc: aws_ec2.Vpc;
}

export class EcsClusterStack extends Stack {
  public readonly cluster: aws_ecs.Cluster;

  constructor(scope: Construct, id: string, props: EcsClusterProps) {
    super(scope, id, props);

    Aspects.of(this).add(new CapacityProviderDependencyAspect());

    // ecs cluster
    this.cluster = new aws_ecs.Cluster(this, "EcsClusterBlueGreen", {
      vpc: props.vpc,
      containerInsights: true,
      enableFargateCapacityProviders: true,
    });
  }
}

/**
 * Add a dependency from capacity provider association to the cluster
 * and from each service to the capacity provider association.
 */
class CapacityProviderDependencyAspect implements IAspect {
  public visit(node: IConstruct): void {
    if (node instanceof aws_ecs.CfnClusterCapacityProviderAssociations) {
      // IMPORTANT: The id supplied here must be the same as the id of your cluster. Don't worry, you won't remove the cluster.
      node.node.scope?.node.tryRemoveChild("EcsClusterBlueGreen");
    }

    if (node instanceof aws_ecs.Ec2Service) {
      const children = node.cluster.node.findAll();
      for (const child of children) {
        if (child instanceof aws_ecs.CfnClusterCapacityProviderAssociations) {
          child.node.addDependency(node.cluster);
          node.node.addDependency(child);
        }
      }
    }
  }
}
